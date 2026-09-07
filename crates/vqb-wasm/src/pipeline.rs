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

use crate::config::MethodConfig;

/// Build the quantizer a method config describes, over input dim `dim`.
pub fn build(method: &MethodConfig, params: &Params, seed: u64, dim: usize) -> Result<Box<dyn Quantizer>> {
    match &method.stages {
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

/// Assemble the stages into a pipeline over input dim `dim`.
///
/// `Pipeline::new` checks that each stage's declared input dim matches what the
/// chain actually produces, so a mismatch is reported by vq-bench rather than
/// discovered as a wrong number at run time.
fn compose(stages: &[crate::config::StageConfig], seed: u64, dim: usize) -> Result<Pipeline> {
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

        let primitive = vqb::primitive_registry::build(&stage.name, &params, stage_seed, running_dim)
            .with_context(|| format!("stage {i}"))?;
        running_dim = primitive.out_dim(running_dim);
        built.push(primitive);
    }
    Pipeline::new(dim, built)
}
