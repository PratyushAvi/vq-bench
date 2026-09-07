//! WebAssembly bindings for vq-bench.
//!
//! The whole JS-facing surface is the four functions below. Everything they
//! report -- quantizer families, param validation, metric values -- is computed
//! by the `vqb` crate; this crate adds no quantization behavior of its own.
//!
//! The boundary is deliberately small and stable: day-to-day UI work should not
//! need a Rust rebuild.

mod config;
mod evaluate;
mod pipeline;

use ndarray::{Array2, ArrayView2};
use serde_json::{json, Value};
use wasm_bindgen::prelude::*;

use config::RunConfig;
use evaluate::{evaluate, Dataset};

/// Every quantizer family: key, display name, accepted params, description.
///
/// Read from the registry rather than hardcoded, so syncing the fork with
/// upstream picks up new families for free.
#[wasm_bindgen]
pub fn list_quantizers() -> String {
    let families: Vec<Value> = vqb::catalog::quantizers()
        .into_iter()
        .map(|q| {
            json!({
                "key": q.key,
                "family": q.family,
                "params": q.params,
                "describe": q.describe,
            })
        })
        .collect();
    to_json(&Value::Array(families))
}

/// Every primitive a custom pipeline can name: key, display name, params, and
/// a one-line description.
///
/// Read from the registry, so a primitive added upstream appears in the builder
/// without a change here. Splitters are absent: they fan out into branch
/// pipelines, which a linear chain cannot express.
#[wasm_bindgen]
pub fn list_primitives() -> String {
    let primitives: Vec<Value> = vqb::primitive_registry::primitives()
        .into_iter()
        .map(|p| {
            json!({
                "key": p.key,
                "display": p.display,
                "params": p.params,
                "describe": p.describe,
            })
        })
        .collect();
    to_json(&Value::Array(primitives))
}

/// Every metric this build can report, with a one-line description.
#[wasm_bindgen]
pub fn list_metrics() -> String {
    let metrics: Vec<Value> = KNOWN_METRICS
        .iter()
        .map(|(name, describe)| json!({ "name": name, "describe": describe }))
        .collect();
    to_json(&Value::Array(metrics))
}

/// The metrics the wasm build computes. The CLI's list additionally carries
/// resource metrics (time, memory); those are not device-independent, so the
/// playground leaves them out.
const KNOWN_METRICS: &[(&str, &str)] = &[
    ("recall", "recall@k: overlap of approx vs true top-k within each query's candidates"),
    ("sos", "SOS@k: summed true score of the approx top-k over that of the true top-k"),
    ("exp_sos", "exp-SOS@k over exponentiated scores, per temperature"),
    ("mse_score", "mean squared error of the estimated scores"),
    ("bias_score", "mean signed error (bias) of the estimated scores"),
    ("mse_recon", "mean squared error of the reconstructed vectors"),
    ("bias_recon", "mean residual (bias) of the reconstructed vectors"),
    ("kl", "softmax KL divergence of approx vs true scores, per temperature"),
    ("tv", "softmax total-variation distance of approx vs true scores, per temperature"),
];

/// The dry run: check the config parses, and that every quantizer, param, and
/// metric it names is real -- without computing anything.
///
/// Returns `{"ok": true}` or `{"ok": false, "errors": [...]}`. Param *values*
/// are checked by the quantizer's own `build`, so this needs a dimension to
/// build against; `dim` may be 0 when it is not yet known, which skips that
/// deeper check and validates names only.
#[wasm_bindgen]
pub fn validate_config(config_json: &str, dim: usize) -> String {
    let config: RunConfig = match serde_json::from_str(config_json) {
        Ok(config) => config,
        Err(err) => return to_json(&json!({ "ok": false, "errors": [err.to_string()] })),
    };

    let mut errors: Vec<String> = Vec::new();

    for metric in &config.metrics {
        if !KNOWN_METRICS.iter().any(|(name, _)| name == metric) {
            errors.push(format!("unknown metric: {metric}"));
        }
    }

    for method in &config.methods {
        let custom = method.stages.is_some();
        if !custom && !vqb::catalog::is_known(&method.name) {
            errors.push(format!("unknown quantizer: {}", method.name));
            continue;
        }
        for params in method.expand() {
            // Names the family does not accept. A bad name also makes `build`
            // fail, so reporting that too would say the same thing twice.
            // A custom pipeline has no family, so its params are checked per
            // stage by the registry instead.
            let bad_names = if custom {
                Vec::new()
            } else {
                vqb::catalog::verify_params(&method.name, &params)
            };
            if !bad_names.is_empty() {
                errors.extend(bad_names.into_iter().map(|p| format!("{}: {p}", method.name)));
                continue;
            }
            // Values it rejects -- only checkable by building it.
            if dim > 0 {
                if let Err(err) = pipeline::build(method, &params, config.seed, dim) {
                    errors.push(format!("{}: {}", method.label(&params), full_chain(&err)));
                }
            }
        }
    }

    if errors.is_empty() {
        to_json(&json!({ "ok": true }))
    } else {
        to_json(&json!({ "ok": false, "errors": errors }))
    }
}

/// Exact top-`l` neighbors for each query, as a flat `n_eval * l` index array.
///
/// A dataset that ships no ground truth needs this before it can be scored
/// against. It is the same block-folded search the native CLI runs, so the
/// candidate pools a browser builds match the ones `vqb data get` would write.
///
/// `on_progress` is called with `(rows_done, rows_total)` as the base is folded
/// in; pass `null` for none. The search is O(n_base * n_eval * dim), so a large
/// base takes real time -- run it in a worker and show the progress.
#[wasm_bindgen]
pub fn top_neighbors(
    base: &[f32],
    eval: &[f32],
    dim: usize,
    l: usize,
    on_progress: Option<js_sys::Function>,
) -> Result<Vec<u32>, JsError> {
    if dim == 0 {
        return Err(JsError::new("dim must be non-zero"));
    }
    if base.len() % dim != 0 || eval.len() % dim != 0 {
        return Err(JsError::new("base/eval lengths must be multiples of dim"));
    }
    let base = ArrayView2::from_shape((base.len() / dim, dim), base)
        .map_err(|e| JsError::new(&e.to_string()))?;
    let eval = ArrayView2::from_shape((eval.len() / dim, dim), eval)
        .map_err(|e| JsError::new(&e.to_string()))?;

    let report = |done: usize, total: usize| {
        if let Some(f) = &on_progress {
            // A throwing callback must not abort the search; ignore its result.
            let _ = f.call2(
                &JsValue::NULL,
                &JsValue::from_f64(done as f64),
                &JsValue::from_f64(total as f64),
            );
        }
    };

    let pools = vqb::candidates::top_neighbors_with_progress(eval, base, l, report);
    // Flat, because a Vec<Vec<_>> would cross the boundary as nested JS arrays.
    Ok(pools
        .into_iter()
        .flat_map(|row| row.into_iter().map(|i| i as u32))
        .collect())
}

/// Run a config against vectors parsed in JS.
///
/// `base` and `eval` are row-major f32 of shape `n x dim`. `candidates` is one
/// flat u32 array of row indices into `base`, `cand_width` per query -- a flat
/// layout because it crosses the wasm boundary as one typed array.
#[wasm_bindgen]
pub fn run(
    config_json: &str,
    base: &[f32],
    eval: &[f32],
    dim: usize,
    candidates: &[u32],
    cand_width: usize,
) -> String {
    match try_run(config_json, base, eval, dim, candidates, cand_width) {
        Ok(results) => to_json(&results),
        Err(err) => to_json(&json!({ "ok": false, "errors": [err] })),
    }
}

fn try_run(
    config_json: &str,
    base: &[f32],
    eval: &[f32],
    dim: usize,
    candidates: &[u32],
    cand_width: usize,
) -> Result<Value, String> {
    let config: RunConfig = serde_json::from_str(config_json).map_err(|e| e.to_string())?;
    let data = build_dataset(base, eval, dim, candidates, cand_width, config.n_eval)?;

    let n_reconstruct = config.n_reconstruct.unwrap_or(data.base.nrows());
    let mut results = Vec::new();

    for method in &config.methods {
        for params in method.expand() {
            let quantizer = pipeline::build(method, &params, config.seed, dim)
                .map_err(|e| format!("{}: {}", method.name, full_chain(&e)))?;
            let mut result = evaluate(
                quantizer.as_ref(),
                &data,
                &config.ks,
                &config.temperatures,
                config.seed,
                n_reconstruct,
                &config.metrics,
            );
            result.label = method.label(&params);
            results.push(result);
        }
    }

    Ok(json!({ "ok": true, "results": results }))
}

/// Reshape the flat typed arrays from JS into the matrices vq-bench expects.
fn build_dataset(
    base: &[f32],
    eval: &[f32],
    dim: usize,
    candidates: &[u32],
    cand_width: usize,
    n_eval: Option<usize>,
) -> Result<Dataset, String> {
    if dim == 0 {
        return Err("dim must be non-zero".into());
    }
    if base.len() % dim != 0 || eval.len() % dim != 0 {
        return Err(format!("base/eval lengths must be multiples of dim ({dim})"));
    }
    if cand_width == 0 || candidates.len() % cand_width != 0 {
        return Err("candidates length must be a non-zero multiple of cand_width".into());
    }

    let n_base = base.len() / dim;
    let mut n_queries = eval.len() / dim;
    if candidates.len() / cand_width != n_queries {
        return Err(format!(
            "got {} candidate rows for {n_queries} queries",
            candidates.len() / cand_width
        ));
    }
    // Take the first n_eval queries, matching the CLI's subsample semantics.
    n_queries = n_eval.unwrap_or(n_queries).min(n_queries);

    if let Some(&bad) = candidates.iter().find(|&&i| i as usize >= n_base) {
        return Err(format!("candidate index {bad} is out of range for {n_base} base rows"));
    }

    let base = Array2::from_shape_vec((n_base, dim), base.to_vec()).map_err(|e| e.to_string())?;
    let eval = Array2::from_shape_vec((eval.len() / dim, dim), eval.to_vec())
        .map_err(|e| e.to_string())?;
    let eval = eval.slice(ndarray::s![..n_queries, ..]).to_owned();

    let candidates = candidates[..n_queries * cand_width]
        .chunks(cand_width)
        .map(|row| row.iter().map(|&i| i as usize).collect())
        .collect();

    Ok(Dataset { base, eval, candidates })
}

/// An anyhow error plus its context chain, joined. Only the outermost message
/// prints by default, which is usually the least specific one.
fn full_chain(err: &anyhow::Error) -> String {
    err.chain()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join(": ")
}

/// Serializing our own owned JSON cannot fail; a panic here would mean a bug,
/// not bad input.
fn to_json(value: &Value) -> String {
    serde_json::to_string(value).expect("serializing owned JSON")
}
