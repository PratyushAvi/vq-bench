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

/// One method entry.
///
/// Either a built-in family by key (`{"name": "minmax", "b": 4}`) or a custom
/// pipeline composed from primitives (`{"name": "custom", "stages": [...]}`).
/// A param whose value is an array is a *sweep* -- upstream semantics -- so
/// `{"b": [2, 4]}` is two runs.
#[derive(Debug, Deserialize)]
pub struct MethodConfig {
    pub name: String,
    /// Present only for a custom pipeline. Stages run in order, each feeding
    /// the next; the chain must end in a rounder or nothing is quantized.
    #[serde(default)]
    pub stages: Option<Vec<StageConfig>>,
    #[serde(flatten)]
    pub params: BTreeMap<String, Value>,
}

/// One stage of a custom pipeline: a primitive key plus its params.
///
/// As with a family's params, an array value is a sweep: a chain carrying
/// `{"name": "cast_uint", "b": [2, 4]}` is two pipelines.
///
/// A splitter (`segment_split`) also carries `branch`, the chain every branch
/// runs; it sweeps like any other stage list.
#[derive(Debug, Deserialize, Clone)]
pub struct StageConfig {
    pub name: String,
    #[serde(default)]
    pub branch: Option<Vec<StageConfig>>,
    #[serde(flatten)]
    pub params: BTreeMap<String, Value>,
}

/// Every combination of one stage's array-valued params (and, for a splitter,
/// of its branch chain), as concrete stages.
fn expand_stage(stage: &StageConfig) -> Vec<StageConfig> {
    let branches: Vec<Option<Vec<StageConfig>>> = match &stage.branch {
        Some(chain) => expand_chain(chain).into_iter().map(Some).collect(),
        None => vec![None],
    };
    let mut combos: Vec<StageConfig> = branches
        .into_iter()
        .map(|branch| StageConfig { name: stage.name.clone(), branch, params: BTreeMap::new() })
        .collect();
    for (key, value) in &stage.params {
        let choices: Vec<Value> = match value {
            Value::Array(items) => items.clone(),
            scalar => vec![scalar.clone()],
        };
        combos = combos
            .iter()
            .flat_map(|base| {
                choices.iter().map(move |choice| {
                    let mut next = base.clone();
                    next.params.insert(key.clone(), choice.clone());
                    next
                })
            })
            .collect();
    }
    combos
}

/// Every combination across a stage list's sweeps, in stage order.
fn expand_chain(stages: &[StageConfig]) -> Vec<Vec<StageConfig>> {
    let mut chains: Vec<Vec<StageConfig>> = vec![Vec::new()];
    for stage in stages {
        let options = expand_stage(stage);
        chains = chains
            .iter()
            .flat_map(|base| {
                options.iter().map(move |option| {
                    let mut next = base.clone();
                    next.push(option.clone());
                    next
                })
            })
            .collect();
    }
    chains
}

/// The (stage, param) pairs a stage list sweeps over, branches included.
fn collect_swept(stages: &[StageConfig], out: &mut Vec<(String, String)>) {
    for stage in stages {
        for (key, value) in &stage.params {
            if matches!(value, Value::Array(items) if items.len() > 1) {
                out.push((stage.name.clone(), key.clone()));
            }
        }
        if let Some(branch) = &stage.branch {
            collect_swept(branch, out);
        }
    }
}

/// The largest `centroids` value in a stage list, branches included.
pub fn max_centroids(stages: &[StageConfig]) -> Option<usize> {
    stages
        .iter()
        .flat_map(|stage| {
            let own = stage.params.get("centroids").and_then(Value::as_u64).map(|c| c as usize);
            own.into_iter().chain(stage.branch.as_deref().and_then(max_centroids))
        })
        .max()
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

    /// Expand a custom pipeline's stage sweeps into concrete stage lists.
    ///
    /// `expand` covers a family's own params, but a composed pipeline carries
    /// its params on the stages instead -- so without this, `b: [2, 4]` on a
    /// stage reached the primitive registry as an array and was rejected. The
    /// two are the same idea and should behave the same way.
    ///
    /// Returns one entry per combination across all stages, in stage order.
    pub fn expand_stages(&self) -> Vec<Vec<StageConfig>> {
        match &self.stages {
            Some(stages) => expand_chain(stages),
            None => Vec::new(),
        }
    }

    /// A human-readable label for one expanded param set: `MinMax (b=4)`.
    pub fn label(&self, params: &vqb::Params) -> String {
        if let Some(stages) = &self.stages {
            return self.label_for(stages);
        }
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

    /// Name one expanded chain by its shape, and by whichever params differ
    /// across the sweep -- otherwise every run of a swept pipeline would carry
    /// the same label and the results could not be told apart.
    pub fn label_for(&self, chain: &[StageConfig]) -> String {
        let swept = self.swept_params();
        format!("{} [{}]", self.name, shape_of(chain, &swept))
    }

    /// The (stage, param) pairs this method sweeps over, so a label mentions
    /// only what actually varies rather than repeating every fixed value.
    fn swept_params(&self) -> Vec<(String, String)> {
        let mut out = Vec::new();
        collect_swept(self.stages.as_deref().unwrap_or_default(), &mut out);
        out
    }
}

/// `a -> b(k=v) -> split[c -> d]`: a chain's shape, with a splitter's branch
/// chain nested in brackets.
fn shape_of(chain: &[StageConfig], swept: &[(String, String)]) -> String {
    let parts: Vec<String> = chain
        .iter()
        .map(|stage| {
            let shown: Vec<String> = stage
                .params
                .iter()
                .filter(|(key, _)| swept.contains(&(stage.name.clone(), (*key).clone())))
                .map(|(key, value)| format!("{key}={value}"))
                .collect();
            let mut text = stage.name.clone();
            if !shown.is_empty() {
                text = format!("{text}({})", shown.join(", "));
            }
            if let Some(branch) = &stage.branch {
                text = format!("{text}[{}]", shape_of(branch, swept));
            }
            text
        })
        .collect();
    parts.join(" -> ")
}
