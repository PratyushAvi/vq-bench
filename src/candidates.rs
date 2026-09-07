//! Exact top-`l` nearest-neighbor search, used to build a dataset's candidate
//! pools when it ships none.
//!
//! Folds the base one row block at a time so the full `n_eval x n_base` score
//! matrix never materializes -- the reason a ~1M-row base is tractable at all.
//! Moved here from the CLI so non-CLI callers (the wasm wrapper) can reuse it
//! rather than reimplementing the ground truth they are graded against.

use std::cmp::Ordering;
use std::collections::BinaryHeap;

use ndarray::{Array2, ArrayView2};

use crate::matmul;

/// Target size of one eval×base score tile (~256 MB), bounding peak memory when
/// brute-forcing candidates over a full (possibly ~1M-row) base.
const SCORE_TILE_BYTES: usize = 256 << 20;

/// Base rows per candidate tile: enough that one `n_eval × rows` f32 score tile stays
/// near `SCORE_TILE_BYTES`.
pub fn tile_rows(n_eval: usize) -> usize {
    (SCORE_TILE_BYTES / (n_eval.max(1) * 4)).max(1)
}

/// One kept candidate, ordered *best first*: descending score, then ascending index. The
/// index tiebreak is what makes a tiled walk reproducible — with equal dots, whichever
/// block happened to arrive first must not decide the order.
struct Candidate {
    score: f32,
    idx: usize,
}

impl Ord for Candidate {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .score
            .total_cmp(&self.score)
            .then(self.idx.cmp(&other.idx))
    }
}
impl PartialOrd for Candidate {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl PartialEq for Candidate {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}
impl Eq for Candidate {}

/// Each eval query's best `l` candidates so far, folded one base row block at a time so
/// the whole `n_eval × n_base` score matrix never materializes. The heaps are max-heaps
/// under `Candidate`'s best-first order, so the root is the next one to evict.
pub struct TopL {
    l: usize,
    /// The queries transposed, hoisted out of the block loop: every block multiplies
    /// against them, and `matmul` would otherwise re-standardize them each time.
    queries: Array2<f32>,
    kept: Vec<BinaryHeap<Candidate>>,
}

impl TopL {
    pub fn new(eval: ArrayView2<f32>, l: usize) -> Self {
        Self {
            l,
            queries: eval.t().as_standard_layout().to_owned(),
            kept: (0..eval.nrows())
                .map(|_| BinaryHeap::with_capacity(l))
                .collect(),
        }
    }

    /// Fold base rows `start..start + block.nrows()` into the running tops. The product
    /// is `block · queriesᵀ` rather than the other way round, so the block — the big
    /// operand — is already in the layout `matmul` wants and is never copied.
    pub fn push_block(&mut self, start: usize, block: ArrayView2<f32>) {
        if self.l == 0 {
            return;
        }
        let scores = matmul(block, self.queries.view()); // block rows × n_eval
        for (j, row) in scores.rows().into_iter().enumerate() {
            for (kept, &score) in self.kept.iter_mut().zip(row) {
                let c = Candidate {
                    score,
                    idx: start + j,
                };
                if kept.len() < self.l {
                    kept.push(c);
                } else if kept.peek().is_some_and(|worst| c < *worst) {
                    kept.pop();
                    kept.push(c);
                }
            }
        }
    }

    /// Each query's candidate indices, best first.
    pub fn finish(self) -> Vec<Vec<usize>> {
        self.finish_scored().0
    }

    /// As `finish`, also handing back the scores it already computed.
    pub fn finish_scored(self) -> CandidatePools {
        let mut idx = Vec::with_capacity(self.kept.len());
        let mut scores = Vec::with_capacity(self.kept.len());
        for kept in self.kept {
            let best_first = kept.into_sorted_vec();
            idx.push(best_first.iter().map(|c| c.idx).collect());
            scores.push(best_first.into_iter().map(|c| c.score).collect());
        }
        (idx, scores)
    }
}

/// Per eval query: its candidate base indices, best first, and their exact scores.
pub type CandidatePools = (Vec<Vec<usize>>, Vec<Vec<f32>>);

/// Exact top-`l` candidates for every eval query, over a base held in memory.
///
/// `on_progress` is called with `(rows_done, rows_total)` after each block, so a
/// caller with no console -- the browser -- can drive its own progress display.
pub fn top_neighbors_with_progress(
    eval: ArrayView2<f32>,
    base: ArrayView2<f32>,
    l: usize,
    mut on_progress: impl FnMut(usize, usize),
) -> Vec<Vec<usize>> {
    let n_base = base.nrows();
    let block = tile_rows(eval.nrows()).min(n_base.max(1));
    let mut top = TopL::new(eval, l.min(n_base));
    for start in (0..n_base).step_by(block.max(1)) {
        let end = (start + block).min(n_base);
        top.push_block(start, base.slice(ndarray::s![start..end, ..]));
        on_progress(end, n_base);
    }
    top.finish()
}
