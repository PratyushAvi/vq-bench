//! Building a primitive by name, so a pipeline can be assembled from config
//! rather than written in Rust.
//!
//! [`catalog`](super::catalog) reports what exists; this reports how to *make*
//! one. Each row carries the param names a stage accepts and a constructor that
//! reads them, mirroring `QuantizerSpec` for quantizer families — so a caller
//! composing a custom pipeline gets the same errors a built-in family would.
//!
//! Only linear stages ([`Primitive`]) appear here. Splitters fan out into
//! branch pipelines, a tree rather than a chain, which a linear
//! [`Pipeline`](crate::Pipeline) cannot express; PQ and OPQ remain available as
//! whole families.

use anyhow::{anyhow, bail, Result};
use serde_json::Value;

use crate::quantizers::catalog::{get, get_or};
use crate::{
    AbsMax, BalanceParts, CastAngular, CastHamming, CastNormal, CastSign, CastUint, Center,
    Kmeans, MinMax, MinMaxDim, Normalize, NormalScale, OptimizePq, OptimizeSigns, Params,
    PcaRotate, Primitive, RandomHadamard, RandomRotate, Resize, Scale,
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
        stateless!("pca_rotate", PcaRotate),
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

