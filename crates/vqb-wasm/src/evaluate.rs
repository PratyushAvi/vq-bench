//! Driving one quantizer through fit -> encode -> score/reconstruct, then
//! handing the raw outputs to `vqb::metrics`.
//!
//! Every number here is computed by vq-bench. This module only decides *what to
//! call and in what order*, mirroring the CLI's run path (`src/bin/vqb/run.rs`)
//! so a browser run and a native run agree.

use std::collections::BTreeMap;

use ndarray::{s, Array2, ArrayView2};
use rand::seq::SliceRandom;
use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;
use serde::Serialize;
use serde_json::{Map, Value};

use vqb::metrics;

/// The vectors a run needs, already parsed out of an `.h5` by JS.
pub struct Dataset {
    pub base: Array2<f32>,
    pub eval: Array2<f32>,
    /// Per-query candidate row indices into `base`. The candidates *are* the
    /// pool a query is scored over; true ranks come from exact scores on them.
    pub candidates: Vec<Vec<usize>>,
}

/// One method's scores, shaped for JSON.
#[derive(Serialize)]
pub struct MethodResult {
    pub label: String,
    pub bits_per_dim: f64,
    #[serde(flatten)]
    pub metrics: Map<String, Value>,
}

/// The CLI salts the master seed before picking reconstruction rows, so the
/// recon sample is independent of other seeded draws (`src/bin/vqb/run.rs`).
const RECON_SEED_SALT: u64 = 0xF17;

/// A seeded subset of `0..len` of size `n`, in the CLI's order (identity when
/// `n >= len`). Sampling policy, not quantizer behavior -- mirrored here so a
/// browser run reconstructs the same rows a native run does.
fn subset_indices(len: usize, n: usize, seed: u64) -> Vec<usize> {
    if n >= len {
        return (0..len).collect();
    }
    let mut rng = ChaCha8Rng::seed_from_u64(seed);
    let mut idx: Vec<usize> = (0..len).collect();
    idx.shuffle(&mut rng);
    idx.truncate(n);
    idx
}

/// Exact inner-product scores for each query against its own candidates. This
/// is the ground truth the approximate scores are graded against; it is plain
/// linear algebra on the raw vectors, not quantizer behavior.
fn true_scores(data: &Dataset) -> Vec<Vec<f32>> {
    data.candidates
        .iter()
        .enumerate()
        .map(|(qi, cand)| {
            let query = data.eval.row(qi);
            cand.iter()
                .map(|&ci| data.base.row(ci).dot(&query))
                .collect()
        })
        .collect()
}

/// Fit `quantizer` on the base, encode every base vector, then score each query
/// against its candidates and reconstruct the sampled rows.
///
/// Encoding runs in one call rather than the CLI's parallel chunks: encode is
/// neighbor-blind, so chunking changes nothing about the output, and v1 is
/// single-threaded anyway.
pub fn evaluate(
    quantizer: &dyn vqb::Quantizer,
    data: &Dataset,
    ks: &[usize],
    temperatures: &[f64],
    seed: u64,
    n_reconstruct: usize,
    wanted: &[String],
) -> MethodResult {
    let model = quantizer.fit(data.base.view(), None);
    let codes = quantizer.encode(&model, data.base.view());

    // Score each query against its own candidate codes, matching the CLI's
    // per-query loop so batching cannot shift the numbers.
    let approx_scores: Vec<Vec<f32>> = data
        .candidates
        .iter()
        .enumerate()
        .map(|(qi, cand)| {
            let cand_codes: Vec<&[u8]> = cand.iter().map(|&ci| codes[ci].as_slice()).collect();
            let query = data.eval.slice(s![qi..qi + 1, ..]);
            let scored = quantizer.score(&model, query, &cand_codes);
            scored.row(0).to_vec()
        })
        .collect();

    let truth = true_scores(data);

    // Reconstruct a seeded sample of base rows -- the same rows the CLI picks,
    // so the recon metrics are comparable run-to-run and browser-to-native.
    let recon_idx = subset_indices(data.base.nrows(), n_reconstruct, seed ^ RECON_SEED_SALT);
    let recon_codes: Vec<&[u8]> = recon_idx.iter().map(|&i| codes[i].as_slice()).collect();
    let recons = quantizer.reconstruct(&model, &recon_codes);
    let references: Vec<Vec<f32>> = recon_idx
        .iter()
        .map(|&i| data.base.row(i).to_vec())
        .collect();
    let recons = rows_to_vec(recons.view());

    let code_bytes: usize = codes.iter().map(Vec::len).sum();
    let bits_per_dim = metrics::bits_per_dim(
        model.len() + code_bytes,
        data.base.nrows(),
        data.base.ncols(),
    );

    MethodResult {
        label: String::new(), // filled in by the caller, which knows the params
        bits_per_dim,
        metrics: collect_metrics(
            &truth,
            &approx_scores,
            &references,
            &recons,
            ks,
            temperatures,
            seed,
            wanted,
        ),
    }
}

/// Compute the requested metrics. Every value comes from `vqb::metrics`; an
/// empty `wanted` means all of them, matching the CLI's config default.
#[allow(clippy::too_many_arguments)]
fn collect_metrics(
    truth: &[Vec<f32>],
    approx: &[Vec<f32>],
    references: &[Vec<f32>],
    recons: &[Vec<f32>],
    ks: &[usize],
    temperatures: &[f64],
    seed: u64,
    wanted: &[String],
) -> Map<String, Value> {
    let want = |name: &str| wanted.is_empty() || wanted.iter().any(|m| m == name);
    let mut out = Map::new();

    if want("recall") {
        out.insert("recall".into(), by_k(metrics::recalls(truth, approx, ks, seed)));
    }
    if want("sos") {
        out.insert("sos".into(), by_k(metrics::sos(truth, approx, ks, seed)));
    }
    if want("exp_sos") {
        let nested = metrics::exp_sos(truth, approx, ks, temperatures, seed);
        let by_temp: Map<String, Value> = nested
            .into_iter()
            .map(|(temp, per_k)| (temp, by_k(per_k)))
            .collect();
        out.insert("exp_sos".into(), Value::Object(by_temp));
    }

    if want("mse_score") || want("bias_score") {
        let (mse, bias) = metrics::score_mse_bias(truth, approx);
        if want("mse_score") {
            out.insert("mse_score".into(), number(mse));
        }
        if want("bias_score") {
            out.insert("bias_score".into(), number(bias));
        }
    }

    if !references.is_empty() {
        if want("mse_recon") {
            out.insert("mse_recon".into(), number(metrics::recon_mse(references, recons)));
        }
        if want("bias_recon") {
            out.insert("bias_recon".into(), number(metrics::recon_bias(references, recons)));
        }
    }

    if want("kl") || want("tv") {
        let (kl, tv) = metrics::softmax_kl_tv(truth, approx, temperatures);
        if want("kl") {
            out.insert("kl".into(), by_temp(kl));
        }
        if want("tv") {
            out.insert("tv".into(), by_temp(tv));
        }
    }

    out
}

/// `{10: 0.87}` -> `{"10": 0.87}`; JSON object keys must be strings.
fn by_k(scores: BTreeMap<usize, f64>) -> Value {
    Value::Object(
        scores
            .into_iter()
            .map(|(k, v)| (k.to_string(), number(v)))
            .collect(),
    )
}

fn by_temp(scores: BTreeMap<String, f64>) -> Value {
    Value::Object(scores.into_iter().map(|(t, v)| (t, number(v))).collect())
}

/// A finite f64 as JSON; NaN/inf are not representable, so they become null.
fn number(value: f64) -> Value {
    serde_json::Number::from_f64(value).map_or(Value::Null, Value::Number)
}

fn rows_to_vec(rows: ArrayView2<f32>) -> Vec<Vec<f32>> {
    rows.rows().into_iter().map(|r| r.to_vec()).collect()
}
