//! The browser's run config: the same JSON vq-bench's CLI accepts, minus the
//! parts that only make sense with a filesystem.
//!
//! The CLI's `RunConfig` names datasets from a registry it reads off disk. In
//! the browser there is no registry -- JS parses the `.h5` and hands us the
//! vectors -- so `datasets` is absent here and everything else keeps its
//! upstream field name and meaning.

use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeMap;

/// One run: a sweep over methods x k-values under one seed.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunConfig {
    /// The quantizers to run, with their (possibly swept) parameters.
    pub methods: Vec<MethodConfig>,

    /// Metrics to report; empty or omitted means all known metrics.
    #[serde(default)]
    pub metrics: Vec<String>,

    /// `k` values for recall@k / SOS@k.
    #[serde(rename = "k", default = "default_ks")]
    pub ks: Vec<usize>,

    /// Softmax temperatures for the kl/tv metrics.
    #[serde(rename = "temp", default = "default_temperatures")]
    pub temperatures: Vec<f64>,

    /// Master seed for all sampling and seeded primitives.
    #[serde(default = "default_seed")]
    pub seed: u64,

    /// Base vectors sampled for reconstruction metrics (default: all).
    #[serde(default)]
    pub n_reconstruct: Option<usize>,

    /// Eval queries sampled for scoring metrics (default: all).
    #[serde(default)]
    pub n_eval: Option<usize>,
}

/// One method entry: a quantizer key plus its params. A param whose value is an
/// array is a *sweep* -- upstream semantics -- so `{"b": [2, 4]}` is two runs.
#[derive(Debug, Deserialize)]
pub struct MethodConfig {
    pub name: String,
    #[serde(flatten)]
    pub params: BTreeMap<String, Value>,
}

fn default_ks() -> Vec<usize> {
    vec![10]
}

fn default_temperatures() -> Vec<f64> {
    vec![0.5, 1.0, 2.0]
}

fn default_seed() -> u64 {
    1
}

impl MethodConfig {
    /// Expand this entry's array-valued params into one concrete param set per
    /// combination, mirroring the CLI's sweep expansion. A scalar param is held
    /// fixed across the sweep; `{"b": [2,4], "x": 1}` yields `b=2,x=1` and
    /// `b=4,x=1`.
    pub fn expand(&self) -> Vec<vqb::Params> {
        let mut combos: Vec<vqb::Params> = vec![BTreeMap::new()];
        for (key, value) in &self.params {
            let choices: Vec<Value> = match value {
                Value::Array(items) => items.clone(),
                scalar => vec![scalar.clone()],
            };
            combos = combos
                .iter()
                .flat_map(|base| {
                    choices.iter().map(move |choice| {
                        let mut next = base.clone();
                        next.insert(key.clone(), choice.clone());
                        next
                    })
                })
                .collect();
        }
        combos
    }

    /// A human-readable label for one expanded param set: `MinMax (b=4)`.
    pub fn label(&self, params: &vqb::Params) -> String {
        let family = vqb::catalog::display(&self.name);
        if params.is_empty() {
            return family.to_string();
        }
        let rendered: Vec<String> = params
            .iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect();
        format!("{family} ({})", rendered.join(", "))
    }
}
