/**
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║  ScoringPanel.jsx — Interactive Scoring Weight Editor                 ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 *
 * ARCHITECTURE ROLE:
 *   Right-panel "Scoring" tab. Provides range sliders + number inputs to
 *   tune the Custom Greening Index weights in real time.
 *
 * DRAFT vs COMMIT PATTERN:
 *   - To avoid expensive score recomputation on every slider tick, this
 *     component maintains a local `draft` state that updates instantly.
 *   - The parent (App.jsx) only receives updates on "commit" events:
 *     mouseup, touchend, blur, or Enter key.
 *   - This means the sliders feel buttery-smooth while the map only
 *     re-renders when the user finishes dragging.
 *
 * AUTO-REBALANCE:
 *   - The `rebalance()` function redistributes remaining budget
 *     (100% - changed slider) proportionally across all other sliders.
 *   - Uses largest-remainder allocation to ensure the total always sums
 *     to exactly 100% (no floating-point drift).
 *
 * RESET:
 *   - "Reset Defaults" restores the weights defined in
 *     SCORING_VARIABLES[].defaultWeight (30/30/30/5/5).
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SCORING_VARIABLES, getDefaultWeights } from '../scoringConfig';

/**
 * Rebalance: given one changed slider, redistribute the remaining budget
 * (100 - newVal) proportionally across the other sliders.
 * Pure function — no side effects.
 */
function rebalance(prev, id, newVal, lockedIds = new Set()) {
    // Total of locked variables (excluding the one being changed)
    const lockedTotal = SCORING_VARIABLES
        .filter(v => lockedIds.has(v.id) && v.id !== id)
        .reduce((sum, v) => sum + (prev[v.id] || 0), 0);

    // The maximum value this parameter can take is 100 - lockedTotal
    const maxAllowed = 100 - lockedTotal;
    const cappedVal = Math.min(newVal, maxAllowed);

    const otherUnlockedIds = SCORING_VARIABLES
        .map(v => v.id)
        .filter(vid => vid !== id && !lockedIds.has(vid));

    const next = { ...prev, [id]: cappedVal };

    if (otherUnlockedIds.length === 0) {
        // If no other unlocked variables exist, we must force the changed variable
        // to equal exactly the remaining available budget to keep the sum at 100.
        next[id] = maxAllowed;
        return next;
    }

    const otherUnlockedSum = otherUnlockedIds.reduce((s, vid) => s + (prev[vid] || 0), 0);
    const remaining = 100 - lockedTotal - cappedVal;

    if (otherUnlockedSum === 0) {
        const base = Math.floor(remaining / otherUnlockedIds.length);
        let leftover = remaining - base * otherUnlockedIds.length;
        for (const vid of otherUnlockedIds) {
            next[vid] = base + (leftover > 0 ? 1 : 0);
            if (leftover > 0) leftover--;
        }
    } else {
        let distributed = 0;
        const raw = otherUnlockedIds.map(vid => {
            const ratio = (prev[vid] || 0) / otherUnlockedSum;
            const exact = ratio * remaining;
            const floored = Math.floor(exact);
            distributed += floored;
            return { vid, floored, frac: exact - floored };
        });
        for (const r of raw) next[r.vid] = r.floored;
        let leftover = remaining - distributed;
        raw.sort((a, b) => b.frac - a.frac);
        for (const r of raw) {
            if (leftover <= 0) break;
            next[r.vid]++;
            leftover--;
        }
    }
    return next;
}

export default function ScoringPanel({ weights, setWeights }) {
    // Local "draft" weights update instantly on every drag tick for smooth visuals.
    // The parent (App.jsx) only receives updates on commit (mouseup / touchend / blur / Enter).
    const [draft, setDraft] = useState(weights);
    const [lockedIds, setLockedIds] = useState(new Set());
    const isDragging = useRef(false);

    // Sync draft when parent weights change externally (e.g. Reset Defaults)
    useEffect(() => {
        if (!isDragging.current) setDraft(weights);
    }, [weights]);

    const total = Object.values(draft).reduce((s, w) => s + w, 0);

    /** Update local draft only (no parent recomputation) */
    const handleDraft = useCallback((id, value) => {
        if (lockedIds.has(id)) return;
        const newVal = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
        setDraft(prev => rebalance(prev, id, newVal, lockedIds));
    }, [lockedIds]);

    /** Commit the current draft to the parent, triggering score recomputation */
    const commitDraft = useCallback(() => {
        isDragging.current = false;
        setDraft(current => {
            setWeights(current);
            return current;
        });
    }, [setWeights]);

    const handleReset = () => {
        const defaults = getDefaultWeights();
        setLockedIds(new Set());
        setDraft(defaults);
        setWeights(defaults);
    };

    const toggleLock = (id) => {
        setLockedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    return (
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px', flex: 1, overflowY: 'auto' }}>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Adjust the weight of each variable in the Custom Greening Index.
                Other weights auto-adjust to keep the total at 100%.
            </div>

            {/* Weight Sliders */}
            {SCORING_VARIABLES.map(v => {
                const pct = draft[v.id] || 0;
                const isLocked = lockedIds.has(v.id);
                const barColor = isLocked ? 'var(--text-muted)' : (pct > 0 ? 'var(--accent-cyan)' : 'var(--text-muted)');
                return (
                    <div key={v.id} style={{
                        padding: '10px 12px',
                        background: 'var(--bg-secondary)',
                        borderRadius: '8px',
                        border: '1px solid var(--border-subtle)',
                        opacity: isLocked ? 0.85 : 1,
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', flex: 1, opacity: isLocked ? 0.7 : 1 }}>
                                {v.label}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <button
                                    onClick={() => toggleLock(v.id)}
                                    title={isLocked ? "Unlock weight" : "Lock weight"}
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        cursor: 'pointer',
                                        fontSize: '0.9rem',
                                        padding: '2px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        opacity: isLocked ? 1 : 0.4,
                                        transition: 'opacity 0.2s',
                                        lineHeight: 1
                                    }}
                                >
                                    {isLocked ? '🔒' : '🔓'}
                                </button>
                                <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    step="1"
                                    value={pct}
                                    disabled={isLocked}
                                    onChange={(e) => {
                                        handleDraft(v.id, e.target.value);
                                    }}
                                    onBlur={() => {
                                        if (!isLocked) setLockedIds(prev => new Set(prev).add(v.id));
                                        commitDraft();
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            if (!isLocked) setLockedIds(prev => new Set(prev).add(v.id));
                                            commitDraft();
                                        }
                                    }}
                                    style={{
                                        width: '42px',
                                        padding: '2px 4px',
                                        fontSize: '0.82rem',
                                        fontWeight: 700,
                                        color: barColor,
                                        background: 'var(--bg-primary)',
                                        border: '1px solid var(--border-subtle)',
                                        borderRadius: '4px',
                                        textAlign: 'right',
                                        outline: 'none',
                                        MozAppearance: 'textfield',
                                        WebkitAppearance: 'none',
                                    }}
                                    className="no-spinners"
                                />
                                <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)' }}>%</span>
                            </div>
                        </div>
                        <input
                            type="range"
                            min="0"
                            max="100"
                            step="1"
                            value={pct}
                            disabled={isLocked}
                            onPointerDown={() => { isDragging.current = true; }}
                            onChange={(e) => handleDraft(v.id, e.target.value)}
                            onPointerUp={commitDraft}
                            onTouchEnd={commitDraft}
                            style={{
                                WebkitAppearance: 'none',
                                appearance: 'none',
                                width: '100%',
                                height: '4px',
                                borderRadius: '2px',
                                outline: 'none',
                                cursor: 'pointer',
                                background: `linear-gradient(to right, var(--accent-cyan) ${pct}%, var(--border-subtle) ${pct}%)`,
                            }}
                        />
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '4px', lineHeight: 1.4 }}>
                            {v.description}
                        </div>
                    </div>
                );
            })}

            {/* Total & Reset */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 12px',
                background: 'rgba(34, 197, 94, 0.08)',
                border: '1px solid rgba(34, 197, 94, 0.3)',
                borderRadius: '8px',
            }}>
                <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 500 }}>Total Weight</div>
                    <div style={{
                        fontSize: '1rem',
                        fontWeight: 700,
                        color: 'rgb(34, 197, 94)',
                    }}>
                        {total}%
                    </div>
                </div>
                <button
                    onClick={handleReset}
                    style={{
                        padding: '6px 14px',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        border: '1px solid var(--border-accent)',
                        borderRadius: '6px',
                        background: 'var(--bg-primary)',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--accent-cyan)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-primary)'}
                >
                    Reset Defaults
                </button>
            </div>
        </div>
    );
}
