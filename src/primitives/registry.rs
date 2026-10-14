//! Building a primitive by name, so a pipeline can be assembled from config
//! rather than written in Rust.
//!
//! [`catalog`](super::catalog) reports what exists; this reports how to *make*
//! one. Each row carries the param names a stage accepts and a constructor that
//! reads them, mirroring `QuantizerSpec` for quantizer families — so a caller
//! composing a custom pipeline gets the same errors a built-in family would.
//!
//! [`primitives`] lists the linear stages ([`Primitive`]). Splitters fan out
//! into branch pipelines, so they are listed separately by [`splitters`] and
//! built by [`build_split`], which takes the branch pipelines as a factory.

use anyhow::{anyhow, bail, Result};
use serde_json::Value;

use crate::quantizers::catalog::{get, get_or};
use crate::{
    AbsMax, BalanceParts, CastAngular, CastHamming, CastNormal, CastSign, CastUint, Center,
    Kmeans, MinMax, MinMaxDim, Normalize, NormalScale, OptimizePq, OptimizeSigns, Params,
    PcaRotate, Pipeline, Primitive, RandomHadamard, RandomRotate, Resize, Scale, SegmentSplit,
    Split, Splitter,
};

/// One buildable stage: its config key, the params it accepts, and how to make
/// it. `build` receives the seed and the dim the stage will see, since some
/// stages need one or both.
#[derive(Clone, Copy)]
pub struct PrimitiveSpec {
    pub key: &'static str,
    pub display: &'static str,
    pub params: &'static [&'static str],
    pub describe: &'static str,
    pub build: fn(&Params, u64, usize) -> Result<Box<dyn Primitive>>,
}

/// A stage with no configuration. Every one of these is a unit struct, so the
/// constructor is the type's own name -- passed in rather than derived, since
/// there is no trait bound that produces a value from nothing.
macro_rules! stateless {
    ($key:literal, $ty:ident) => {
        PrimitiveSpec {
            key: $key,
            display: <$ty as Primitive>::name(),
            params: &[],
            describe: <$ty as Primitive>::describe(),
            build: |_, _, _| Ok(Box::new($ty)),
        }
    };
}

/// Every stage that can be named in a custom pipeline.
pub fn primitives() -> Vec<PrimitiveSpec> {
    vec![
        stateless!("center", Center),
        stateless!("normalize", Normalize),
        stateless!("absmax", AbsMax),
        PrimitiveSpec {
            key: "pca_rotate",
            display: <PcaRotate as Primitive>::name(),
            params: &["rank"],
            describe: <PcaRotate as Primitive>::describe(),
            // Checked here rather than left to PcaRotate's asserts, which would
            // panic mid-fit instead of failing validation.
            build: |p, _, dim| {
                let rank = get_or(p, "rank", dim)?;
                if rank == 0 || rank > dim {
                    bail!("pca_rotate: rank must be in 1..={dim}, got {rank}");
                }
                Ok(Box::new(if rank == dim {
                    PcaRotate::default()
                } else {
                    PcaRotate::truncated(rank)
                }))
            },
        },
        PrimitiveSpec {
            key: "minmax",
            display: <MinMax as Primitive>::name(),
            params: &["lo", "hi"],
            describe: <MinMax as Primitive>::describe(),
            build: |p, _, _| {
                Ok(Box::new(MinMax::new(
                    get_or(p, "lo", 0.0f32)?,
                    get_or(p, "hi", 1.0f32)?,
                )))
            },
        },
        PrimitiveSpec {
            key: "minmax_dim",
            display: <MinMaxDim as Primitive>::name(),
            params: &["lo", "hi"],
            describe: <MinMaxDim as Primitive>::describe(),
            build: |p, _, _| {
                Ok(Box::new(MinMaxDim::new(
                    get_or(p, "lo", 0.0f32)?,
                    get_or(p, "hi", 1.0f32)?,
                )))
            },
        },
        PrimitiveSpec {
            key: "scale",
            display: <Scale as Primitive>::name(),
            params: &["scale", "offset"],
            describe: <Scale as Primitive>::describe(),
            build: |p, _, _| {
                Ok(Box::new(Scale::new(
                    get_or(p, "scale", 1.0f32)?,
                    get_or(p, "offset", 0.0f32)?,
                )))
            },
        },
        PrimitiveSpec {
            key: "random_rotate",
            display: <RandomRotate as Primitive>::name(),
            params: &[],
            describe: <RandomRotate as Primitive>::describe(),
            build: |_, seed, _| Ok(Box::new(RandomRotate::new(seed))),
        },
        PrimitiveSpec {
            key: "random_hadamard",
            display: <RandomHadamard as Primitive>::name(),
            params: &[],
            describe: <RandomHadamard as Primitive>::describe(),
            build: |_, seed, _| Ok(Box::new(RandomHadamard::new(seed))),
        },
        PrimitiveSpec {
            key: "optimize_signs",
            display: <OptimizeSigns as Primitive>::name(),
            params: &[],
            describe: <OptimizeSigns as Primitive>::describe(),
            build: |_, seed, _| Ok(Box::new(OptimizeSigns::new(seed))),
        },
        PrimitiveSpec {
            key: "balance_parts",
            display: <BalanceParts as Primitive>::name(),
            params: &["section_dim"],
            describe: <BalanceParts as Primitive>::describe(),
            build: |p, _, _| Ok(Box::new(BalanceParts::new(get(p, "section_dim")?))),
        },
        PrimitiveSpec {
            key: "resize",
            display: <Resize as Primitive>::name(),
            params: &["dim"],
            describe: <Resize as Primitive>::describe(),
            build: |p, _, _| Ok(Box::new(Resize::to(get(p, "dim")?))),
        },
        PrimitiveSpec {
            key: "optimize_pq",
            display: <OptimizePq as Primitive>::name(),
            params: &["centroids", "section_dim", "iters"],
            describe: <OptimizePq as Primitive>::describe(),
            build: |p, seed, _| {
                Ok(Box::new(OptimizePq::new(
                    get(p, "centroids")?,
                    get(p, "section_dim")?,
                    get_or(p, "iters", 25usize)?,
                    seed,
                )))
            },
        },
        PrimitiveSpec {
            key: "cast_uint",
            display: <CastUint as Primitive>::name(),
            params: &["b"],
            describe: <CastUint as Primitive>::describe(),
            build: |p, _, _| Ok(Box::new(CastUint::new(bits(p)?))),
        },
        PrimitiveSpec {
            key: "cast_angular",
            display: <CastAngular as Primitive>::name(),
            params: &["b"],
            describe: <CastAngular as Primitive>::describe(),
            build: |p, _, _| Ok(Box::new(CastAngular::new(bits(p)?))),
        },
        PrimitiveSpec {
            key: "cast_normal",
            display: <CastNormal as Primitive>::name(),
            params: &["b", "mode"],
            describe: <CastNormal as Primitive>::describe(),
            build: |p, _, _| {
                let raw = p.get("mode").and_then(Value::as_str).unwrap_or("plain");
                let mode = match raw {
                    "plain" => NormalScale::Plain,
                    "mse" => NormalScale::BiasedMse,
                    "unbiased" => NormalScale::Unbiased,
                    other => bail!("unknown mode `{other}` (expected `plain`, `mse` or `unbiased`)"),
                };
                Ok(Box::new(CastNormal::new(bits(p)?, mode)))
            },
        },
        stateless!("cast_sign", CastSign),
        stateless!("cast_hamming", CastHamming),
        PrimitiveSpec {
            key: "kmeans",
            display: <Kmeans as Primitive>::name(),
            params: &["centroids"],
            describe: <Kmeans as Primitive>::describe(),
            build: |p, seed, _| Ok(Box::new(Kmeans::new(get(p, "centroids")?, seed))),
        },
    ]
}

/// The shared `b` param: bit width, in the range the bit-packer supports.
fn bits(p: &Params) -> Result<u8> {
    let b: u8 = get(p, "b")?;
    if !(1..=crate::coding::CodeLayout::MAX_BITS).contains(&b) {
        bail!("b must be in 1..={}, got {b}", crate::coding::CodeLayout::MAX_BITS);
    }
    Ok(b)
}

/// Look up a stage by its config key.
pub fn lookup(key: &str) -> Option<PrimitiveSpec> {
    primitives().into_iter().find(|p| p.key == key)
}

/// Build one stage from its key and params.
pub fn build(key: &str, params: &Params, seed: u64, dim: usize) -> Result<Box<dyn Primitive>> {
    let spec = lookup(key).ok_or_else(|| anyhow!("unknown primitive `{key}`"))?;
    for name in params.keys() {
        if !spec.params.contains(&name.as_str()) {
            bail!(
                "unknown param `{name}` for primitive `{key}` (accepts: {})",
                spec.params.join(", ")
            );
        }
    }
    (spec.build)(params, seed, dim).map_err(|e| e.context(format!("primitive `{key}`")))
}

/// Unused today, but kept alongside `build` so a caller can report a param
/// problem without constructing the stage.
pub fn param_names(key: &str) -> Option<&'static [&'static str]> {
    lookup(key).map(|s| s.params)
}


/// One buildable splitter: its config key and the params it accepts. The branch
/// pipelines are not a param -- the caller supplies them to [`build_split`].
#[derive(Clone, Copy)]
pub struct SplitterSpec {
    pub key: &'static str,
    pub display: &'static str,
    pub params: &'static [&'static str],
    pub describe: &'static str,
}

/// Every splitter that can head a fan-out stage in a custom pipeline.
pub fn splitters() -> Vec<SplitterSpec> {
    vec![SplitterSpec {
        key: "segment_split",
        display: <SegmentSplit as Splitter>::name(),
        params: &["section_dim"],
        describe: <SegmentSplit as Splitter>::describe(),
    }]
}

/// Build a fan-out stage: splitter `key` over input dim `dim`, with
/// `branch(i, branch_dim)` giving branch `i`'s child pipeline.
///
/// `branch` is called lazily at fit time, so it cannot report an error then;
/// call [`split_branch_dims`] first and check the branches it names.
pub fn build_split<F>(
    key: &str,
    params: &Params,
    dim: usize,
    branch: F,
) -> Result<Box<dyn Primitive>>
where
    F: Fn(usize, usize) -> Pipeline + Send + Sync + 'static,
{
    match key {
        "segment_split" => {
            let section_dim = segment_section_dim(params, dim)?;
            Ok(Box::new(Split::from_factory(SegmentSplit::new(dim, section_dim), branch)))
        }
        other => bail!("unknown splitter `{other}`"),
    }
}

/// The distinct branch widths splitter `key` yields over `dim` (segment splits give
/// `section_dim`, plus a shorter last one when it does not divide `dim`), so a caller
/// can validate a branch pipeline for each before building.
pub fn split_branch_dims(key: &str, params: &Params, dim: usize) -> Result<Vec<usize>> {
    match key {
        "segment_split" => {
            let section_dim = segment_section_dim(params, dim)?;
            let mut dims = vec![section_dim.min(dim)];
            if !dim.is_multiple_of(section_dim) {
                dims.push(dim % section_dim);
            }
            Ok(dims)
        }
        other => bail!("unknown splitter `{other}`"),
    }
}

fn segment_section_dim(p: &Params, dim: usize) -> Result<usize> {
    let section_dim: usize = get(p, "section_dim")?;
    if !(1..=dim).contains(&section_dim) {
        bail!("section_dim must be in 1..={dim}, got {section_dim}");
    }
    Ok(section_dim)
}

/// Look up a splitter by its config key.
pub fn splitter_lookup(key: &str) -> Option<SplitterSpec> {
    splitters().into_iter().find(|s| s.key == key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::testing::params;
    use serde_json::json;

    #[test]
    fn segment_branch_dims_include_the_ragged_tail() {
        let p = params(&[("section_dim", json!(4))]);
        assert_eq!(split_branch_dims("segment_split", &p, 8).unwrap(), vec![4]);
        assert_eq!(split_branch_dims("segment_split", &p, 10).unwrap(), vec![4, 2]);
        assert!(split_branch_dims("segment_split", &params(&[("section_dim", json!(9))]), 8).is_err());
        assert!(split_branch_dims("nope", &p, 8).is_err());
    }
}
