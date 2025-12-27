# Integrate Cosine Reconstruction into Full Stargate System

## Background
We discovered that **cosine reconstruction loss on normalized embeddings** is the key breakthrough for compositional generalization (93.6% novel accuracy vs MLP's 0.9%). However, this was only implemented in a simplified model (V5-V13) that uses:
- MLP encoders → L2 normalized embeddings
- Cosine similarity loss: `1 - cosine_similarity(learned, true)`
- Bilinear composition: `domain ⊙ (W @ type) + α·domain + β·type`

**The Problem:** We never integrated this back into the full Stargate/Hypermind system:
- SymbolLayer (hyperbolic soft clustering)
- StargateLayer (AND gate composition)
- ConceptSpace (hierarchical manifolds)
- EnergyFunction (synergy, cost, radius, verifier)
- HebbianLearning (gate strengthening)

## Goal
Integrate cosine reconstruction into the full Stargate architecture and experimentally determine which components contribute to compositional generalization.

---

## Technical Challenge

**V5 Winning Model**: Euclidean space with normalized unit vectors
- Embeddings: `||emb|| = 1` (unit sphere)
- Distance: `1 - cosine_similarity(a, b)`
- Works because cosine measures angular similarity

**Full Stargate**: Hyperbolic space (Lorentz hyperboloid)
- Embeddings: `-x₀² + ||x_{1:}||² = -1/K` (hyperboloid constraint)
- Distance: `(1/√-K) * arcosh(-⟨x, y⟩_L)` (Minkowski inner product)
- Designed for hierarchical representations

**Key Insight**: These are fundamentally different metric spaces!

---

## Integration Strategy: Incremental Ablation

Rather than integrating everything at once, we'll add components incrementally and measure each contribution.

### Phase 1: Baseline with Euclidean Symbol Layer
**File:** `experiments/compositional_navigation/tuning/stargate_integrated_v1.py`

Start with V5 architecture, add a **Euclidean symbol layer** for soft clustering:
- Keep normalized Euclidean embeddings
- Add learnable centroids (also normalized)
- Soft assignment via cosine similarity (not hyperbolic distance)
- Measure if soft clustering helps or hurts

### Phase 2: Add Gate Mechanism
**File:** `experiments/compositional_navigation/tuning/stargate_integrated_v2.py`

Add AND gates on top of symbol layer:
- Each gate requires multiple symbols to co-activate
- Gate output = product of required symbol probabilities
- Composition happens through gate selection
- Question: Do gates help compositional generalization?

### Phase 3: Project to Hyperbolic Space
**File:** `experiments/compositional_navigation/tuning/stargate_integrated_v3.py`

Bridge Euclidean→Hyperbolic:
```python
# V5 produces normalized Euclidean embeddings
emb_euclidean = F.normalize(encoder(x), p=2, dim=-1)  # unit sphere

# Project to tangent space at hyperboloid origin (identity mapping)
v_tangent = emb_euclidean  # tangent space at origin is Euclidean

# Map to hyperboloid via exp_map_0
emb_hyperbolic = manifold.exp_map_0(v_tangent)
```

Then apply:
- Hyperbolic symbol layer with hyperbolic distances
- Cosine reconstruction still in Euclidean (before projection)

### Phase 4: Add Energy Function
**File:** `experiments/compositional_navigation/tuning/stargate_integrated_v4.py`

Add energy-based guidance:
- SynergyNet: Distance to goal attractors
- RadiusNet: Encourage specificity
- Use energy gradient for composition refinement

### Phase 5: Add Hebbian Learning
**File:** `experiments/compositional_navigation/tuning/stargate_integrated_v5.py`

Add experience-based gate strengthening:
- When composition succeeds (low distance to target), strengthen gate connections
- Hebbian update: `Δw = η · success · pre · post`

---

## Implementation Plan

### File 1: `stargate_integrated_v1.py`
Euclidean Symbol Layer + V5 Architecture

**Changes from V5:**
```python
class EuclideanSymbolLayer(nn.Module):
    """Soft symbol assignment using cosine similarity (not hyperbolic)."""
    def __init__(self, num_symbols, dim):
        self.centroids = nn.Parameter(torch.randn(num_symbols, dim))

    def forward(self, x):
        # Normalize both x and centroids
        x_norm = F.normalize(x, p=2, dim=-1)
        c_norm = F.normalize(self.centroids, p=2, dim=-1)

        # Cosine similarity as soft assignment
        similarities = torch.mm(x_norm, c_norm.t())  # (batch, num_symbols)
        probs = F.softmax(similarities / temperature, dim=-1)
        return probs
```

**Integration:**
1. Encode domain/type with V5 encoders (normalized)
2. Get symbol assignments for both
3. Compose via bilinear (unchanged)
4. Add cosine reconstruction loss (unchanged)

### File 2: `stargate_integrated_v2.py`
Add Gate Mechanism

**Gate Logic:**
```python
class EuclideanGateLayer(nn.Module):
    """AND gates over symbols, Euclidean version."""
    def __init__(self, num_gates, num_symbols, symbols_per_gate):
        # Learnable gate-symbol assignments
        self.gate_symbols = nn.Parameter(torch.randn(num_gates, num_symbols))
        self.threshold = nn.Parameter(torch.tensor(0.3))

    def forward(self, domain_probs, type_probs):
        # Combined symbol activation
        combined = domain_probs * type_probs  # element-wise product

        # Gate activation = product of top-k symbol probs
        gate_weights = torch.sigmoid(self.gate_symbols)
        topk_vals, topk_idx = torch.topk(gate_weights, k=symbols_per_gate, dim=-1)

        gate_acts = []
        for g in range(self.num_gates):
            symbol_acts = combined[:, topk_idx[g]]
            gate_acts.append(symbol_acts.prod(dim=-1))  # AND = product

        return torch.stack(gate_acts, dim=-1)
```

### File 3: `stargate_integrated_v3.py`
Add Hyperbolic Projection

**Bridge Layer:**
```python
class EuclideanToHyperbolic(nn.Module):
    """Project normalized Euclidean embeddings to hyperboloid."""
    def __init__(self, dim, curvature=-1.0):
        self.manifold = LorentzManifold(dim=dim, curvature=curvature)

    def forward(self, x_euclidean):
        # x_euclidean is normalized (unit sphere)
        # Treat as tangent vector at origin
        return self.manifold.exp_map_0(x_euclidean)
```

---

## Evaluation Protocol

For each version, measure:
1. **Novel Accuracy @0.30**: Primary metric
2. **Seen Accuracy @0.30**: Sanity check
3. **Generalization Gap**: Seen - Novel
4. **Cosine Similarity**: Embedding quality check
5. **Gate Engagement**: What % of gates activate (V2+)
6. **Symbol Entropy**: Are symbols being used diversely?

---

## ACTUAL RESULTS (EXPERIMENTS COMPLETED)

| Version | Novel Acc | What's Added | Finding |
|---------|-----------|--------------|---------|
| V5 (baseline) | **93.6%** | - | Cosine reconstruction is THE KEY |
| Integrated V1 | **93.6%** | Euclidean symbols | NEUTRAL - doesn't help or hurt |
| Integrated V2 | **25.0%** | Gates + per-gate heads | HARMFUL - gate heads enable memorization |
| Integrated V2b | **93.6%** | Gates, no heads | NEUTRAL - gate structure alone doesn't hurt |
| Integrated V3 | **0.0%** | Hyperbolic projection | CATASTROPHIC - hyperbolic composition fails |

## KEY FINDINGS

### 1. Cosine Reconstruction is THE KEY (and ONLY key)
- The breakthrough is `1 - cosine_similarity(learned, true)` on normalized embeddings
- This forces embeddings to preserve directional structure
- MSE loss fails because it doesn't enforce normalization

### 2. Euclidean Symbol Layers are NEUTRAL
- Soft clustering via cosine similarity doesn't help or hurt
- Symbols collapse to sharp assignments (entropy → 0)
- Only 3-4 of 16 symbols actually used

### 3. Gate-Specific Heads are CATASTROPHIC
- Per-gate output transformations enable memorization
- Novel combinations have no matching gates → fail completely
- This is why V2 dropped from 93.6% to 25%

### 4. Gate Structure Alone is NEUTRAL
- When gates don't produce separate outputs (V2b), generalization preserved
- Gates can be diagnostic but shouldn't drive behavior

### 5. Hyperbolic Geometry is CATASTROPHIC
- Projecting to hyperbolic space and composing in tangent space fails completely
- 0% novel accuracy (vs 93.6% Euclidean)
- The bilinear composition structure doesn't transfer to hyperbolic geometry
- Our compositional task has no natural hierarchy that hyperbolic geometry could exploit

## CONCLUSION

**The winning architecture is already V5:**
- Simple MLP encoders
- L2 normalization to unit vectors
- Cosine reconstruction loss
- Bilinear composition: `d ⊙ (W @ t) + α·d + β·t`

**The full Stargate system DOES NOT HELP compositional generalization because:**
1. Hyperbolic geometry distorts the bilinear composition structure
2. Gate-specific outputs enable memorization instead of generalization
3. Symbols add complexity without benefit

**When might Stargate help?**
- Tasks with natural hierarchical structure (taxonomy, ontology)
- Tasks where different gates need genuinely different behaviors
- Tasks where hyperbolic distance is meaningful

**For compositional generalization, stick with Euclidean cosine reconstruction.**

---

# NEXT PHASE: Extending Cosine Reconstruction for Complex Composition

## The Problem: Beyond 2-Component Composition

V5's cosine reconstruction works perfectly for flat 2-component composition (domain × type). But real problems often require:

1. **Multi-component composition**: Binary arithmetic (operand1, operator, operand2)
2. **Recursive/nested composition**: Nested SCAN ("jump twice slowly" = ((jump × twice) × slowly))
3. **Chain reasoning**: Transitive relations (A→B, B→C ⇒ A→C)
4. **Query-dependent composition**: "What color is the square?" requires selecting which binding to retrieve
5. **Variable-length composition**: Unknown number of components at runtime

**Current workarounds are hacks:**
- Binary arithmetic flattens (operand2, operator) into a single index → loses structure
- Transitive reasoning encodes position hints in embeddings → not truly learned
- Nested SCAN uses same formula for all depths → implicit, not explicit

## Core Insight to Preserve

The V5 breakthrough: **Cosine reconstruction forces directional structure preservation**

```python
loss = 1 - cosine_similarity(learned_embedding, true_embedding)
```

This works because:
- Normalized embeddings live on unit sphere
- Network can't memorize arbitrary mappings
- Must learn the actual compositional structure

**Any extension must preserve this property while handling more complex structure.**

---

## Architectural Extensions (V6-V9)

### V6: Recursive Bilinear Composition
**Goal**: Handle chains of composition (A→B→C)

**Architecture**:
```python
def recursive_compose(components: List[Tensor], W: Tensor) -> Tensor:
    """Recursively compose components left-to-right."""
    result = components[0]
    for c in components[1:]:
        # Apply bilinear composition at each step
        result = result * (W @ c) + alpha * result + beta * c
        result = F.normalize(result, p=2, dim=-1)  # Renormalize!
    return result
```

**Loss**: Cosine reconstruction at final output AND intermediate steps
```python
total_loss = 0
for depth, intermediate_target in enumerate(intermediate_targets):
    loss_i = 1 - cosine_sim(intermediate_pred[depth], intermediate_target)
    total_loss += loss_i
```

**Test on**: Transitive reasoning (A→B→C chains)

### V7: Trilinear Composition
**Goal**: True 3-way composition without flattening

**Architecture**:
```python
class TrilinearComposer(nn.Module):
    def __init__(self, dim):
        # Two mixing matrices for 3-way interaction
        self.W1 = nn.Parameter(torch.randn(dim, dim) * 0.1)
        self.W2 = nn.Parameter(torch.randn(dim, dim) * 0.1)
        self.alpha = nn.Parameter(torch.tensor(0.3))
        self.beta = nn.Parameter(torch.tensor(0.3))
        self.gamma = nn.Parameter(torch.tensor(0.3))

    def forward(self, c1, c2, c3):
        # c1 ⊙ (W1 @ c2) ⊙ (W2 @ c3) + residuals
        composed = c1 * (self.W1 @ c2) * (self.W2 @ c3)
        composed = composed + self.alpha * c1 + self.beta * c2 + self.gamma * c3
        return F.normalize(composed, p=2, dim=-1)
```

**Loss**: Cosine reconstruction on final normalized output

**Test on**: Binary arithmetic (operand1 × operator × operand2)

### V8: Attention-Guided Variable-Length Composition
**Goal**: Dynamic composition based on query

**Architecture**:
```python
class AttentionComposer(nn.Module):
    def __init__(self, dim, num_heads=4):
        self.query_proj = nn.Linear(dim, dim)
        self.key_proj = nn.Linear(dim, dim)
        self.value_proj = nn.Linear(dim, dim)
        self.composition_mlp = nn.Sequential(
            nn.Linear(dim, dim * 2),
            nn.ReLU(),
            nn.Linear(dim * 2, dim)
        )

    def forward(self, query, components: List[Tensor]):
        # query: what we're looking for
        # components: variable number of embeddings

        q = self.query_proj(query)
        keys = torch.stack([self.key_proj(c) for c in components])
        values = torch.stack([self.value_proj(c) for c in components])

        # Attention weights via cosine similarity (not dot product!)
        q_norm = F.normalize(q, dim=-1)
        k_norm = F.normalize(keys, dim=-1)
        attn = torch.softmax(q_norm @ k_norm.T / temperature, dim=-1)

        # Weighted combination
        aggregated = attn @ values
        composed = self.composition_mlp(aggregated)
        return F.normalize(composed, p=2, dim=-1)
```

**Loss**: Cosine reconstruction + attention sparsity regularization

**Test on**: Attribute binding queries ("color of square?")

### V9: Hierarchical Composition with Discrete Bottleneck
**Goal**: Create interpretable intermediate concepts

**Architecture**:
```python
class HierarchicalComposer(nn.Module):
    def __init__(self, dim, num_concepts=32):
        self.concept_embeddings = nn.Parameter(torch.randn(num_concepts, dim))
        self.level1_composer = BilinearComposer(dim)  # V5 style
        self.level2_composer = BilinearComposer(dim)  # V5 style

    def forward(self, primitives: List[Tensor]):
        # Level 1: Compose pairs into intermediate concepts
        concepts_norm = F.normalize(self.concept_embeddings, dim=-1)

        intermediates = []
        for i in range(0, len(primitives), 2):
            composed = self.level1_composer(primitives[i], primitives[i+1])

            # Soft assignment to discrete concepts (cosine similarity!)
            sims = composed @ concepts_norm.T
            concept_weights = F.softmax(sims / temperature, dim=-1)
            intermediate = concept_weights @ concepts_norm
            intermediate = F.normalize(intermediate, dim=-1)
            intermediates.append(intermediate)

        # Level 2: Compose intermediates
        while len(intermediates) > 1:
            new_intermediates = []
            for i in range(0, len(intermediates), 2):
                if i + 1 < len(intermediates):
                    composed = self.level2_composer(intermediates[i], intermediates[i+1])
                    new_intermediates.append(composed)
                else:
                    new_intermediates.append(intermediates[i])
            intermediates = new_intermediates

        return intermediates[0]
```

**Loss**: Cosine reconstruction at each level + concept diversity regularization

**Test on**: Nested SCAN with variable depth

---

## Experimental Protocol

### Phase 1: V6 Recursive Composition
**Files to create**:
- `experiments/compositional_benchmark/models/recursive_composer.py`
- `experiments/compositional_navigation/tuning/recursive_v6.py`

**Tasks**:
1. Extend TransitiveReasoningTask to provide intermediate targets
2. Train V6 with multi-step cosine loss
3. Compare to V5 (flattened) and baselines

**Success metric**: >70% novel accuracy on 3-hop chains

### Phase 2: V7 Trilinear Composition
**Files to create**:
- `experiments/compositional_benchmark/models/trilinear_composer.py`
- `experiments/compositional_navigation/tuning/trilinear_v7.py`

**Tasks**:
1. Fix BinaryArithmeticTask to expose all 3 components separately
2. Train V7 on true 3-way composition
3. Compare to V5 (flattened operand2+operator)

**Success metric**: >60% novel accuracy, improved interpretability

### Phase 3: V8 Attention Composition
**Files to create**:
- `experiments/compositional_benchmark/models/attention_composer.py`
- `experiments/compositional_navigation/tuning/attention_v8.py`

**Tasks**:
1. Create AttributeQueryTask variant with explicit queries
2. Train V8 with cosine-based attention
3. Analyze attention patterns on novel queries

**Success metric**: >80% novel accuracy, interpretable attention

### Phase 4: V9 Hierarchical Composition
**Files to create**:
- `experiments/compositional_benchmark/models/hierarchical_composer.py`
- `experiments/compositional_navigation/tuning/hierarchical_v9.py`

**Tasks**:
1. Extend NestedScanTask with variable depth
2. Train V9 with level-wise cosine loss
3. Analyze learned concept space

**Success metric**: >70% novel accuracy, emergent concept structure

---

## Key Design Principles

1. **Cosine reconstruction at EVERY level**
   - Not just final output, intermediate compositions too
   - Prevents error accumulation through chain

2. **Always normalize**
   - After every composition step, L2 normalize
   - Keeps embeddings on unit sphere

3. **Cosine-based attention** (not dot product)
   - Uses angular similarity, not magnitude
   - Preserves the directional structure insight

4. **Test on harder variants first**
   - If V6 can't beat V5 on 3-hop chains, stop
   - Don't add complexity unless it helps

5. **Interpretability as side benefit**
   - V9's discrete concepts should be meaningful
   - Attention weights should be sparse and interpretable

---

## When WOULD Full Stargate Help?

Based on our experiments, the full Stargate system (hyperbolic geometry, gates, energy functions) would help when:

1. **Natural hierarchy exists**: Taxonomy (dog → mammal → animal), ontologies
   - Hyperbolic geometry captures tree-like structure efficiently
   - But our compositional tasks are flat, not hierarchical

2. **Different gates need different behaviors**: Multi-task learning where tasks are distinct
   - Gates can route to specialized sub-networks
   - But compositional generalization requires SHARED structure, not specialization

3. **Energy landscape encodes problem structure**: Planning, optimization
   - Attractors can guide search toward goals
   - But our tasks have closed-form composition rules

**For compositional generalization specifically, stick with Euclidean cosine reconstruction.**

---

## Files to Create (New Phase)

1. `experiments/compositional_benchmark/models/recursive_composer.py` - V6
2. `experiments/compositional_benchmark/models/trilinear_composer.py` - V7
3. `experiments/compositional_benchmark/models/attention_composer.py` - V8
4. `experiments/compositional_benchmark/models/hierarchical_composer.py` - V9
5. `experiments/compositional_navigation/tuning/recursive_v6.py` - V6 experiment
6. `experiments/compositional_navigation/tuning/trilinear_v7.py` - V7 experiment
7. `experiments/compositional_navigation/tuning/attention_v8.py` - V8 experiment
8. `experiments/compositional_navigation/tuning/hierarchical_v9.py` - V9 experiment

## Files to Modify

1. `experiments/compositional_benchmark/tasks/relational.py` - Add intermediate targets for V6
2. `experiments/compositional_benchmark/tasks/arithmetic.py` - Expose 3 components for V7
3. `experiments/compositional_benchmark/tasks/attribute_binding.py` - Add query interface for V8
4. `experiments/compositional_benchmark/tasks/scan_style.py` - Variable depth for V9

---

## Execution Order (New Phase)

1. **V6**: Start with recursive composition on transitive reasoning
2. **Evaluate**: If V6 fails, the problem is harder than anticipated
3. **V7**: If V6 works, try trilinear on arithmetic
4. **V8**: Then attention-based for query tasks
5. **V9**: Finally hierarchical for nested structures
6. **Analysis**: Compare all variants, document findings

---

## Success Criteria (New Phase)

1. **At least one extension beats V5** on its target task
2. **Cosine reconstruction remains key** - removing it should hurt all variants
3. **Interpretability preserved** - can visualize what the model learns
4. **Clear guidance** - know when to use V5 vs extensions

---

# UNIFIED ARCHITECTURE: Universal Compositional Network (UCN)

## Overview

Instead of separate V6-V9 models, we build a **single unified architecture** that handles all composition patterns through configuration, not code changes.

```
Input Components [c1, c2, ..., cn] + Optional Query + Optional Structure
                      │
                      ▼
         ┌────────────────────────┐
         │   Component Encoders   │  ← One per type, all L2 normalize
         └────────────────────────┘
                      │
         ┌────────────────────────┐
         │ Cosine Reconstruction  │  ← Loss at embedding level (THE KEY)
         └────────────────────────┘
                      │
                      ▼
         ┌────────────────────────┐
         │  Structure Controller  │  ← explicit / learned / sequential
         └────────────────────────┘
                      │
                      ▼
         ┌────────────────────────┐
         │  Composition Kernel    │  ← Bilinear, applied recursively
         │  + L2 norm each step   │  ← Cosine loss at each step
         └────────────────────────┘
                      │
                      ▼
         ┌────────────────────────┐
         │  Query Selector (opt)  │  ← Cosine-attention for binding
         └────────────────────────┘
                      │
                      ▼
              Final Output (Normalized)
```

---

## Core Components

### 1. Unified Input Format

```python
@dataclass
class CompositionInput:
    """Single input format for ALL composition tasks."""
    components: List[torch.Tensor]      # Variable number of inputs
    component_types: List[int]          # Type ID for encoder selection
    structure: Optional[CompositionTree] = None  # How to compose
    query: Optional[torch.Tensor] = None         # For selection tasks
    targets: Optional[List[torch.Tensor]] = None # Multi-level supervision
    clean_components: Optional[List[torch.Tensor]] = None  # For reconstruction
```

### 2. Component Encoder Bank

```python
class ComponentEncoderBank(nn.Module):
    """One encoder per component type, ALL outputs L2 normalized."""

    def forward(self, components, types):
        encoded = []
        for comp, ctype in zip(components, types):
            raw = self.encoders[ctype](comp)
            normalized = F.normalize(raw, p=2, dim=-1)  # CRITICAL
            encoded.append(normalized)
        return encoded
```

### 3. Composition Kernel (Universal Operator)

```python
class CompositionKernel(nn.Module):
    """The V5 bilinear formula, applied recursively."""

    def __init__(self, emb_dim, num_composition_types=1):
        # Bank of W matrices for different composition types
        self.W = nn.Parameter(torch.randn(num_composition_types, emb_dim, emb_dim) * 0.3)
        self.alpha = nn.Parameter(torch.tensor(0.3))
        self.beta = nn.Parameter(torch.tensor(0.3))

    def forward(self, left, right, composition_type=0):
        W = self.W[composition_type]
        composed = left * (W @ right) + self.alpha * left + self.beta * right
        return F.normalize(composed, p=2, dim=-1)  # ALWAYS normalize
```

### 4. Structure Controller

```python
class StructureController(nn.Module):
    """Determines composition order via three modes."""

    # Mode 1: explicit - Use provided CompositionTree
    # Mode 2: learned - Attention determines which to compose next
    # Mode 3: sequential - Left-to-right: [(0,1), (result,2), (result,3), ...]

    def get_composition_order(self, components, explicit_structure=None):
        if self.mode == "explicit" and explicit_structure:
            return explicit_structure.get_order()
        elif self.mode == "learned":
            return self._learn_structure(components)  # Attention-based
        else:
            return [(i-1 if i>1 else 0, i) for i in range(1, len(components))]
```

### 5. Multi-Level Cosine Loss

```python
class MultiLevelCosineLoss(nn.Module):
    """Cosine reconstruction at EVERY composition step."""

    def forward(self, predictions: List[Tensor], targets: List[Tensor]):
        total_loss = 0
        for pred, target in zip(predictions, targets):
            pred_norm = F.normalize(pred, dim=-1)
            target_norm = F.normalize(target, dim=-1)
            cos_loss = (1 - F.cosine_similarity(pred_norm, target_norm, dim=-1)).mean()
            total_loss += cos_loss
        return total_loss
```

### 6. Query Selector (for Binding Tasks)

```python
class QuerySelector(nn.Module):
    """Cosine-attention selection over composed candidates."""

    def forward(self, candidates: List[Tensor], query: Tensor):
        # Project and normalize
        query_proj = F.normalize(self.query_proj(query), dim=-1)
        candidate_projs = [F.normalize(self.cand_proj(c), dim=-1) for c in candidates]

        # Cosine similarity as attention (NOT dot product!)
        stacked = torch.stack(candidate_projs, dim=1)
        attention = F.softmax((stacked * query_proj.unsqueeze(1)).sum(-1), dim=-1)

        selected = (attention.unsqueeze(-1) * stacked).sum(dim=1)
        return F.normalize(selected, dim=-1)
```

---

## Task-Specific Configuration

The SAME model handles all tasks through configuration:

### Domain × Type (V5 - 2-way)
```python
model = UCN(num_types=2, structure_mode="sequential", use_query=False)
input = CompositionInput(
    components=[domain_noisy, type_noisy],
    component_types=[0, 1],
    targets=[final_target],
    clean_components=[domain_clean, type_clean],
)
```

### Chain Reasoning (V6 - A→B→C)
```python
model = UCN(num_types=3, structure_mode="sequential", use_query=False)
input = CompositionInput(
    components=[A, B, C],
    component_types=[0, 1, 2],
    targets=[AB_target, ABC_target],  # Intermediate targets!
    clean_components=[A_clean, B_clean, C_clean],
)
```

### Trilinear (V7 - 3-way simultaneous)
```python
model = UCN(num_types=3, num_W=2, structure_mode="explicit", use_query=False)
input = CompositionInput(
    components=[A, B, C],
    component_types=[0, 1, 2],
    structure=CompositionTree.from_nested([[0, 1], 2]),  # ((A⊙B)⊙C)
    targets=[final_target],
)
```

### Attribute Binding (V8 - Query Selection)
```python
model = UCN(num_types=2, structure_mode="explicit", use_query=True)
input = CompositionInput(
    components=[shape1, color1, shape2, color2],
    component_types=[0, 1, 0, 1],
    structure=CompositionTree.parallel([[0,1], [2,3]]),  # Two objects
    query=query_shape,  # "Which shape's color?"
    targets=[target_color],
)
```

### Nested/Hierarchical (V9)
```python
model = UCN(num_types=4, num_W=2, structure_mode="explicit", use_query=False)
input = CompositionInput(
    components=[prim, mod1, mod2, mod3],
    component_types=[0, 1, 1, 1],
    structure=CompositionTree.from_nested([[[0, 1], 2], 3]),  # Deep nesting
    targets=[level1_target, level2_target, final_target],  # Per-level
)
```

---

## Implementation Files

### New Files to Create

1. **`experiments/compositional_benchmark/models/unified_composer.py`**
   - `CompositionInput` dataclass
   - `ComponentEncoderBank`
   - `CompositionKernel`
   - `StructureController`
   - `QuerySelector`
   - `MultiLevelCosineLoss`
   - `UnifiedCompositionalNetwork` (main class)

2. **`experiments/compositional_benchmark/utils/composition_tree.py`**
   - `CompositionTree` class for explicit structure
   - `from_nested()` factory method
   - `parallel()` for multi-object composition
   - `get_composition_order()` method

3. **`experiments/compositional_navigation/tuning/unified_v1.py`**
   - Test UCN on Domain×Type (should match V5's 93.6%)

4. **`experiments/compositional_navigation/tuning/unified_v2_chain.py`**
   - Test UCN on 3-hop transitive reasoning

5. **`experiments/compositional_navigation/tuning/unified_v3_trilinear.py`**
   - Test UCN on binary arithmetic

6. **`experiments/compositional_navigation/tuning/unified_v4_binding.py`**
   - Test UCN on attribute binding with queries

### Files to Modify

1. **`experiments/compositional_benchmark/tasks/relational.py`**
   - Add intermediate target generation for chains

2. **`experiments/compositional_benchmark/tasks/arithmetic.py`**
   - Expose all 3 components separately (not flattened)

3. **`experiments/compositional_benchmark/tasks/attribute_binding.py`**
   - Add query interface for selection variant

---

## Execution Order

1. **Create `unified_composer.py`** - Core UCN architecture
2. **Create `composition_tree.py`** - Structure utilities
3. **Test on Domain×Type** - Verify matches V5 baseline (93.6%)
4. **Test on chains** - 3-hop transitive reasoning
5. **Test on trilinear** - Binary arithmetic with true 3-way
6. **Test on binding** - Query-dependent selection
7. **Ablation study** - Remove cosine loss, verify it breaks everything

---

## Success Criteria (Unified)

1. **Baseline parity**: UCN achieves 93.6% on Domain×Type (same as V5)
2. **Chain reasoning**: >70% on 3-hop transitive
3. **Trilinear**: >60% on binary arithmetic
4. **Query binding**: >80% on attribute binding
5. **Single codebase**: All tasks use same UnifiedCompositionalNetwork class
6. **Cosine is key**: Removing cosine loss drops ALL tasks significantly

---

# EXPERIMENTAL RESULTS (COMPLETED)

## UCN Performance Summary

| Task | Target | Achieved | Holdout | Notes |
|------|--------|----------|---------|-------|
| **Domain×Type (V1)** | 93.6% | **93.6%** ✓ | 25% | Baseline match confirmed |
| **Chain Reasoning (V2)** | >70% | **100%** ✓ | 25% | Perfect generalization |
| **Trilinear (V3)** | >60% | **100%** ✓ | 50% | Even with harder split |
| **Attribute Binding (V4)** | >80% | **16%** ✗ | 25% | Not compositional |

## Key Insight: When Does Bilinear Composition Generalize?

**WORKS when composition IS the ground truth:**
- Domain×Type: `output = domain ⊙ (W @ type) + α·domain + β·type`
- Chain: `output = ((A ⊙ W @ B) ⊙ W @ C)`
- Trilinear: `output = (A ⊙ W1 @ B) ⊙ W2 @ C`

**FAILS when there's NO compositional structure:**
- Attribute Binding: shape→color mapping is ARBITRARY
- No formula connects shapes to colors
- Each pair must be memorized individually

## Architecture Validated

The **Unified Compositional Network (UCN)** successfully:
1. Handles 2-way, 3-way, and recursive composition
2. Uses single codebase with configuration-driven behavior
3. Preserves 93.6% baseline while extending to complex tasks
4. Achieves 100% novel accuracy on tasks with true compositional structure

## Files Created

1. `experiments/compositional_benchmark/models/unified_composer.py` - Core UCN
2. `experiments/compositional_navigation/tuning/unified_v1.py` - Domain×Type test
3. `experiments/compositional_navigation/tuning/unified_v2_chain.py` - Chain test
4. `experiments/compositional_navigation/tuning/unified_v3_trilinear.py` - Trilinear test
5. `experiments/compositional_navigation/tuning/unified_v4_binding.py` - Binding test
6. `experiments/compositional_navigation/tuning/unified_v4b_binding_direct.py` - Binding analysis

## Conclusion

**When to use UCN:**
- Tasks where bilinear composition defines the ground truth
- Multi-step reasoning with chain composition
- 3-way or n-way compositional tasks
- Any task where the composition RULE should generalize

**When NOT to use UCN:**
- Arbitrary key-value lookups (like shape→color)
- Tasks requiring memorization of specific associations
- Non-compositional structure in data

**The cosine reconstruction principle remains THE KEY:**
- Works across all compositional task types
- Forces learning of directional structure
- Prevents memorization of arbitrary mappings

---

## Files to Create

1. `experiments/compositional_navigation/tuning/stargate_integrated_v1.py`
2. `experiments/compositional_navigation/tuning/stargate_integrated_v2.py`
3. `experiments/compositional_navigation/tuning/stargate_integrated_v3.py`
4. `experiments/compositional_navigation/tuning/stargate_integrated_v4.py`
5. `experiments/compositional_navigation/tuning/stargate_integrated_v5.py`

## Files to Reference

- `experiments/compositional_navigation/tuning/stargate_v5.py` - Winning baseline
- `hypermind/nn/symbols.py` - Symbol layer implementation
- `hypermind/nn/stargate.py` - Gate mechanism
- `hypermind/nn/concepts.py` - Concept space
- `hypermind/nn/energy.py` - Energy function
- `hypermind/nn/hebbian.py` - Hebbian learning
- `hypermind/geometry/lorentz.py` - Hyperbolic geometry

---

## Execution Order

1. Create `stargate_integrated_v1.py` - Add Euclidean symbol layer
2. Run and compare to V5 baseline
3. If comparable, create V2 with gates
4. If gates help, add hyperbolic projection in V3
5. Continue incrementally based on results
6. Document findings in results

---

## Success Criteria

1. Identify which Stargate components improve compositional generalization
2. Either achieve >93.6% novel (improvement) OR understand why full system doesn't help
3. Create a "best of both worlds" architecture if beneficial components found

---

# Previous Plan: Multi-Task Benchmark (COMPLETE)

---

## Benchmark Tasks

### Task 1: Domain × Type Navigation (DONE)
**Status**: ✅ Complete - 93.6% novel (99.9% @0.35)
- Input: [domain_emb, type_emb] with noise
- Output: Composed position
- Composition: domain ⊙ (W @ type) + α·domain + β·type

### Task 2: Attribute Binding
**The binding problem** - associating attributes with objects
- Input: "red circle, blue square" encoded as [obj1_shape, obj1_color, obj2_shape, obj2_color]
- Query: "color of square?"
- Output: "blue" embedding
- Composition: Must bind attributes to correct objects

**Why hard for transformers**: Attention can confuse which attribute belongs to which object

### Task 3: Relational Composition
**Transitive reasoning**
- Train: A→B, B→C relationships
- Test: A→C (compose relations)
- Input: [entity_A, relation_type]
- Output: entity_C position

**Why hard**: Requires chaining learned relations

### Task 4: Arithmetic Composition
**Few-shot arithmetic**
- Train: Single operations (3+2, 4×2)
- Test: Composed operations (3+2×4)
- Input: [operand1, operator, operand2] embeddings
- Output: Result embedding

**Why hard**: Transformers need many examples to learn arithmetic

### Task 5: SCAN-style Sequence Composition
**Compositional instruction following**
- Train: Primitives ("jump" → JUMP, "twice" → repeat 2x)
- Test: Compositions ("jump twice" → JUMP JUMP)
- Input: Command embedding
- Output: Action sequence embedding

**Why hard**: Classic transformer failure case

---

## Directory Structure

```
experiments/compositional_benchmark/
├── __init__.py
├── config.py                    # Unified config for all tasks
├── base/
│   ├── __init__.py
│   ├── task.py                  # Abstract base class for tasks
│   ├── model.py                 # BilinearComposer base
│   └── evaluation.py            # Unified metrics
│
├── tasks/
│   ├── __init__.py
│   ├── domain_type.py           # Task 1 (port from tuning/)
│   ├── attribute_binding.py     # Task 2
│   ├── relational.py            # Task 3
│   ├── arithmetic.py            # Task 4
│   └── scan_style.py            # Task 5
│
├── models/
│   ├── __init__.py
│   ├── bilinear_composer.py     # Our winning architecture
│   ├── mlp_baseline.py          # MLP baseline
│   └── transformer_baseline.py  # Transformer baseline
│
├── run_benchmark.py             # Run all tasks
├── analyze_results.py           # Generate comparison charts
└── results/
    └── {timestamp}/
        ├── config.json
        ├── results_by_task.json
        └── BENCHMARK_REPORT.md
```

---

## Implementation Plan

### Phase 1: Framework Setup
**Files to create:**
1. `experiments/compositional_benchmark/__init__.py`
2. `experiments/compositional_benchmark/config.py` - Unified config
3. `experiments/compositional_benchmark/base/task.py` - Abstract task class
4. `experiments/compositional_benchmark/base/model.py` - Model interfaces
5. `experiments/compositional_benchmark/base/evaluation.py` - Metrics

### Phase 2: Port Existing Work
**Files to create:**
1. `experiments/compositional_benchmark/tasks/domain_type.py` - Port from V5
2. `experiments/compositional_benchmark/models/bilinear_composer.py` - Port V5 model

### Phase 3: Baselines
**Files to create:**
1. `experiments/compositional_benchmark/models/mlp_baseline.py` - Simple MLP
2. `experiments/compositional_benchmark/models/transformer_baseline.py` - Small transformer

### Phase 4: New Tasks
**Files to create:**
1. `experiments/compositional_benchmark/tasks/attribute_binding.py`
2. `experiments/compositional_benchmark/tasks/relational.py`
3. `experiments/compositional_benchmark/tasks/arithmetic.py`
4. `experiments/compositional_benchmark/tasks/scan_style.py`

### Phase 5: Benchmark Runner
**Files to create:**
1. `experiments/compositional_benchmark/run_benchmark.py` - Main runner
2. `experiments/compositional_benchmark/analyze_results.py` - Analysis

---

## Key Design Decisions

### Abstract Task Interface
```python
class CompositionalTask(ABC):
    @abstractmethod
    def create_space(self, config) -> CompositionSpace

    @abstractmethod
    def create_split(self, space, holdout_frac) -> (train_pairs, novel_pairs)

    @abstractmethod
    def get_composition_rule(self) -> str  # Human-readable description

    @property
    @abstractmethod
    def input_dim(self) -> int

    @property
    @abstractmethod
    def output_dim(self) -> int
```

### Unified Model Interface
```python
class CompositionalModel(ABC):
    @abstractmethod
    def forward(self, query, target=None, **aux) -> dict
        # Returns: {"pred", "loss", "distance", ...}

    @abstractmethod
    def get_embeddings(self, query) -> dict
        # Returns: {"emb1", "emb2", ...} for analysis
```

### Evaluation Metrics (per task)
```python
{
    "accuracy_0.25": float,
    "accuracy_0.30": float,
    "accuracy_0.35": float,
    "mean_distance": float,
    "max_distance": float,
    "embedding_cosine": float,  # If applicable
    "training_samples": int,
    "novel_samples": int,
}
```

---

## Expected Results Table

| Task | Training Coverage | MLP | Transformer | Ours |
|------|-------------------|-----|-------------|------|
| Domain×Type | 75% | 0% | ~60%* | **93.6%** |
| Attribute Binding | 75% | ~20%* | ~50%* | **>80%** |
| Relational | 75% | 0%* | ~40%* | **>70%** |
| Arithmetic | 50% | 0%* | ~30%* | **>60%** |
| SCAN-style | 75% | 0%* | ~20%* | **>70%** |

*Estimates - to be measured

---

## Success Criteria

1. **Sample Efficiency**: Achieve >80% novel accuracy with <80% training coverage on 3+ tasks
2. **Transformer Comparison**: Outperform transformer by >20% on novel combinations
3. **Consistency**: Show the pattern holds across task types
4. **The Killer Chart**: Sample efficiency curve showing our advantage

---

## Files to Modify (Existing)
- None - this is a new benchmark suite

## Files to Create (New)
1. `experiments/compositional_benchmark/__init__.py`
2. `experiments/compositional_benchmark/config.py`
3. `experiments/compositional_benchmark/base/__init__.py`
4. `experiments/compositional_benchmark/base/task.py`
5. `experiments/compositional_benchmark/base/model.py`
6. `experiments/compositional_benchmark/base/evaluation.py`
7. `experiments/compositional_benchmark/tasks/__init__.py`
8. `experiments/compositional_benchmark/tasks/domain_type.py`
9. `experiments/compositional_benchmark/tasks/attribute_binding.py`
10. `experiments/compositional_benchmark/tasks/relational.py`
11. `experiments/compositional_benchmark/tasks/arithmetic.py`
12. `experiments/compositional_benchmark/tasks/scan_style.py`
13. `experiments/compositional_benchmark/models/__init__.py`
14. `experiments/compositional_benchmark/models/bilinear_composer.py`
15. `experiments/compositional_benchmark/models/mlp_baseline.py`
16. `experiments/compositional_benchmark/models/transformer_baseline.py`
17. `experiments/compositional_benchmark/run_benchmark.py`
18. `experiments/compositional_benchmark/analyze_results.py`

---

## Execution Order

1. **Framework** (Phase 1): Base classes and config
2. **Port Domain×Type** (Phase 2): Validate framework works
3. **Baselines** (Phase 3): MLP and Transformer
4. **Attribute Binding** (Phase 4a): First new task
5. **Run comparison** on 2 tasks to validate approach
6. **Remaining tasks** (Phase 4b-d): Relational, Arithmetic, SCAN
7. **Full benchmark run** (Phase 5): All tasks, all models
8. **Analysis and charts** (Phase 5): Generate report
