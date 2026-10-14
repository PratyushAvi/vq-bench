//! Building a quantizer from a method config -- either a built-in family or a
//! pipeline the user composed from primitives.
//!
//! A composed pipeline is assembled by `vqb::primitive_registry` and executed
//! through `AsQuantizer`, the crate's own adapter for ad-hoc chains. Nothing
//! about quantization is decided here: stage construction, param validation and
//! dim compatibility are all vq-bench's, so a custom chain fails the same way a
//! built-in family would.

use anyhow::{bail, Context, Result};

use vqb::{AsQuantizer, Params, Pipeline, Quantizer};

use crate::config::{MethodConfig, StageConfig};

/// Build the quantizer a method config describes, over input dim `dim`.
///
/// `chain` is the already-expanded stage list for a custom pipeline -- stage
/// params sweep like a family's do, so the caller picks one combination and
/// passes it here rather than this reading `method.stages` itself.
pub fn build(
    method: &MethodConfig,
    params: &Params,
    chain: Option<&[StageConfig]>,
    seed: u64,
    dim: usize,
) -> Result<Box<dyn Quantizer>> {
    match chain {
        None => vqb::catalog::build(&method.name, params, seed, dim),
        Some(stages) => {
            if !params.is_empty() {
                let names: Vec<&str> = params.keys().map(String::as_str).collect();
                bail!(
                    "a custom pipeline takes no method-level params, got: {}. \
                     Put them on the stage that uses them.",
                    names.join(", ")
                );
            }
            Ok(Box::new(AsQuantizer(compose(stages, seed, dim)?)))
        }
    }
}

/// One stage: a registry primitive, or a splitter wrapping its `branch` chain.
fn build_stage(
    stage: &StageConfig,
    params: &Params,
    seed: u64,
    dim: usize,
) -> Result<Box<dyn vqb::Primitive>> {
    let Some(spec) = vqb::primitive_registry::splitter_lookup(&stage.name) else {
        if stage.branch.is_some() {
            bail!("`{}` is not a splitter, so it takes no `branch`", stage.name);
        }
        return vqb::primitive_registry::build(&stage.name, params, seed, dim);
    };
    let Some(branch) = stage.branch.as_ref().filter(|b| !b.is_empty()) else {
        bail!("splitter `{}` needs a `branch` chain with at least one stage", stage.name);
    };
    if let Some(name) = params.keys().find(|n| !spec.params.contains(&n.as_str())) {
        bail!(
            "unknown param `{name}` for splitter `{}` (accepts: {})",
            stage.name,
            spec.params.join(", ")
        );
    }

    // The branch factory cannot fail at fit time, so build the chain once per
    // distinct branch width now: any error it would hit surfaces here instead.
    for branch_dim in vqb::primitive_registry::split_branch_dims(&stage.name, params, dim)? {
        compose(branch, seed, branch_dim).with_context(|| format!("branch of `{}`", stage.name))?;
    }
    let branch = branch.clone();
    vqb::primitive_registry::build_split(&stage.name, params, dim, move |b, branch_dim| {
        // A distinct seed per branch, as `pq` does, so branches do not share a stream.
        compose(&branch, seed.wrapping_add(b as u64), branch_dim)
            .expect("branch chain was validated for this width")
    })
}

/// Assemble the stages into a pipeline over input dim `dim`.
///
/// `Pipeline::new` checks that each stage's declared input dim matches what the
/// chain actually produces, so a mismatch is reported by vq-bench rather than
/// discovered as a wrong number at run time.
fn compose(stages: &[StageConfig], seed: u64, dim: usize) -> Result<Pipeline> {
    if stages.is_empty() {
        bail!("a custom pipeline needs at least one stage");
    }

    let mut built = Vec::with_capacity(stages.len());
    let mut running_dim = dim;
    for (i, stage) in stages.iter().enumerate() {
        // Every seeded stage gets the run's seed by default, which is what the
        // built-in families do -- so composing a family's documented chain by
        // hand reproduces its numbers exactly. A stage can override with its
        // own `seed` when a chain needs two *different* random rotations.
        let stage_seed = stage
            .params
            .get("seed")
            .map(|v| {
                v.as_u64()
                    .with_context(|| format!("stage {i}: `seed` must be a non-negative integer"))
            })
            .transpose()?
            .unwrap_or(seed);

        // `seed` is handled here, not by the stage's own constructor.
        let mut params = stage.params.clone();
        params.remove("seed");

        let primitive = build_stage(stage, &params, stage_seed, running_dim)
            .with_context(|| format!("stage {i}"))?;
        running_dim = primitive.out_dim(running_dim);
        built.push(primitive);
    }
    Pipeline::new(dim, built)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ndarray::Array2;
    use serde_json::json;

    fn method(stages: serde_json::Value) -> MethodConfig {
        serde_json::from_value(json!({ "name": "custom", "stages": stages })).unwrap()
    }

    fn data(n: usize, dim: usize) -> Array2<f32> {
        Array2::from_shape_fn((n, dim), |(i, j)| ((i * 31 + j * 7) % 17) as f32 - 8.0)
    }

    fn build_custom(m: &MethodConfig, dim: usize) -> Result<Box<dyn Quantizer>> {
        let chains = m.expand_stages();
        build(m, &Params::new(), Some(&chains[0]), 1, dim)
    }

    #[test]
    fn segment_split_matches_pq() {
        let m = method(json!([{
            "name": "segment_split", "section_dim": 4,
            "branch": [{ "name": "kmeans", "centroids": 4 }],
        }]));
        let custom = build_custom(&m, 12).unwrap();
        let pq = vqb::catalog::build(
            "pq",
            &serde_json::from_value(json!({ "centroids": 4, "section_dim": 4 })).unwrap(),
            1,
            12,
        )
        .unwrap();

        let v = data(64, 12);
        let (cm, pm) = (custom.fit(v.view(), None), pq.fit(v.view(), None));
        assert_eq!(cm, pm);
        let (cc, pc) = (custom.encode(&cm, v.view()), pq.encode(&pm, v.view()));
        assert_eq!(cc, pc);
    }

    #[test]
    fn ragged_last_segment_builds() {
        // 10 = 4 + 4 + 2: the branch must be valid at both widths.
        let ok = method(json!([{
            "name": "segment_split", "section_dim": 4,
            "branch": [{ "name": "cast_uint", "b": 2 }],
        }]));
        assert!(build_custom(&ok, 10).is_ok());

        // An invalid branch stage is reported when the splitter is built, not at fit.
        let bad = method(json!([{
            "name": "segment_split", "section_dim": 4,
            "branch": [{ "name": "resize", "dim": 3 }, { "name": "cast_uint", "b": 9 }],
        }]));
        assert!(build_custom(&bad, 10).is_err());
    }

    #[test]
    fn rejects_malformed_splitters() {
        let no_branch = method(json!([{ "name": "segment_split", "section_dim": 4 }]));
        assert!(build_custom(&no_branch, 8).is_err());

        let empty = method(json!([{ "name": "segment_split", "section_dim": 4, "branch": [] }]));
        assert!(build_custom(&empty, 8).is_err());

        let stray = method(json!([{ "name": "center", "branch": [{ "name": "center" }] }]));
        assert!(build_custom(&stray, 8).is_err());

        let too_wide = method(json!([{
            "name": "segment_split", "section_dim": 99,
            "branch": [{ "name": "cast_uint", "b": 2 }],
        }]));
        assert!(build_custom(&too_wide, 8).is_err());

        let bad_param = method(json!([{
            "name": "segment_split", "section_dim": 4, "b": 2,
            "branch": [{ "name": "cast_uint", "b": 2 }],
        }]));
        assert!(build_custom(&bad_param, 8).is_err());
    }

    #[test]
    fn branch_sweeps_expand_and_label() {
        let m = method(json!([{
            "name": "segment_split", "section_dim": [4, 8],
            "branch": [{ "name": "cast_uint", "b": [2, 4] }],
        }]));
        let chains = m.expand_stages();
        assert_eq!(chains.len(), 4);
        let labels: Vec<String> = chains.iter().map(|c| m.label_for(c)).collect();
        assert_eq!(labels.len(), labels.iter().collect::<std::collections::HashSet<_>>().len());
        assert!(labels[0].contains("segment_split(section_dim=4)[cast_uint(b=2)]"), "{labels:?}");
    }
}
