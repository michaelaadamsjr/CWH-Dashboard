import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SCORING_VARIABLES, getDefaultWeights } from '../scoringConfig';

const SCHOOL_INDEX_OPTIONS = [
    { value: 'CWHScore', label: 'Custom Greening Index' },
    { value: 'CanopyHeatReliefScore', label: 'Canopy Heat Relief' },
    { value: 'DisadvantagedCommunitiesScore', label: 'Community Opportunity Score' },
    { value: 'infilpot_pctl', label: 'Infiltration Potential' },
];

function rebalance(prev, id, newVal, lockedIds = new Set()) {
    const lockedTotal = SCORING_VARIABLES
        .filter(v => lockedIds.has(v.id) && v.id !== id)
        .reduce((sum, v) => sum + (prev[v.id] || 0), 0);

    const maxAllowed = 100 - lockedTotal;
    const cappedVal = Math.min(newVal, maxAllowed);

    const otherUnlockedIds = SCORING_VARIABLES
        .map(v => v.id)
        .filter(vid => vid !== id && !lockedIds.has(vid));

    const next = { ...prev, [id]: cappedVal };

    if (otherUnlockedIds.length === 0) {
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

export default function ScoringPanel({
    weights,
    setWeights,
    activeSchoolMetric = 'CWHScore',
    setActiveSchoolMetric,
}) {
    const [draft, setDraft] = useState(weights);
    const [lockedIds, setLockedIds] = useState(new Set());
    const isDragging = useRef(false);
    const isCustomIndex = activeSchoolMetric === 'CWHScore';

    useEffect(() => {
        if (!isDragging.current) setDraft(weights);
    }, [weights]);

    const total = Object.values(draft).reduce((s, w) => s + w, 0);

    const handleDraft = useCallback((id, value) => {
        if (!isCustomIndex || lockedIds.has(id)) return;
        const newVal = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
        setDraft(prev => rebalance(prev, id, newVal, lockedIds));
    }, [isCustomIndex, lockedIds]);

    const commitDraft = useCallback(() => {
        isDragging.current = false;
        if (!isCustomIndex) return;
        setDraft(current => {
            setWeights(current);
            return current;
        });
    }, [isCustomIndex, setWeights]);

    const handleReset = () => {
        const defaults = getDefaultWeights();
        setLockedIds(new Set());
        setDraft(defaults);
        setWeights(defaults);
        if (!isCustomIndex && setActiveSchoolMetric) {
            setActiveSchoolMetric('CWHScore');
        }
    };

    const toggleLock = (id) => {
        if (!isCustomIndex) return;
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    School Index
                </label>
                <select
                    value={activeSchoolMetric}
                    onChange={(e) => setActiveSchoolMetric && setActiveSchoolMetric(e.target.value)}
                    className="metric-select"
                    style={{ width: '100%' }}
                >
                    {SCHOOL_INDEX_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </select>
            </div>

            {!isCustomIndex && (
                <div style={{
                    fontSize: '0.72rem',
                    color: 'var(--text-muted)',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '8px',
                    padding: '8px 10px',
                    lineHeight: 1.45,
                }}>
                    Single-index mode is active. Switch to <strong>Custom Greening Index</strong> to edit weights.
                </div>
            )}

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
                                    disabled={!isCustomIndex}
                                    title={isLocked ? 'Unlock weight' : 'Lock weight'}
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        cursor: isCustomIndex ? 'pointer' : 'not-allowed',
                                        fontSize: '0.65rem',
                                        padding: '2px 4px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        opacity: !isCustomIndex ? 0.25 : (isLocked ? 1 : 0.6),
                                        transition: 'opacity 0.2s',
                                        lineHeight: 1,
                                        color: 'var(--text-secondary)',
                                        minWidth: '32px',
                                    }}
                                >
                                    {isLocked ? 'LOCKED' : 'LOCK'}
                                </button>
                                <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    step="1"
                                    value={pct}
                                    disabled={!isCustomIndex || isLocked}
                                    onChange={(e) => {
                                        handleDraft(v.id, e.target.value);
                                    }}
                                    onBlur={() => {
                                        if (isCustomIndex && !isLocked) setLockedIds(prev => new Set(prev).add(v.id));
                                        commitDraft();
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            if (isCustomIndex && !isLocked) setLockedIds(prev => new Set(prev).add(v.id));
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
                            disabled={!isCustomIndex || isLocked}
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
                                cursor: isCustomIndex && !isLocked ? 'pointer' : 'not-allowed',
                                background: `linear-gradient(to right, var(--accent-cyan) ${pct}%, var(--border-subtle) ${pct}%)`,
                            }}
                        />
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '4px', lineHeight: 1.4 }}>
                            {v.description}
                        </div>
                    </div>
                );
            })}

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
                    disabled={!isCustomIndex}
                    style={{
                        padding: '6px 14px',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        border: '1px solid var(--border-accent)',
                        borderRadius: '6px',
                        background: !isCustomIndex ? 'var(--bg-secondary)' : 'var(--bg-primary)',
                        color: !isCustomIndex ? 'var(--text-muted)' : 'var(--text-primary)',
                        cursor: isCustomIndex ? 'pointer' : 'not-allowed',
                        transition: 'all 0.15s',
                    }}
                    onMouseEnter={(e) => {
                        if (isCustomIndex) e.currentTarget.style.background = 'var(--accent-cyan)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.background = !isCustomIndex ? 'var(--bg-secondary)' : 'var(--bg-primary)';
                    }}
                >
                    Reset Defaults
                </button>
            </div>
        </div>
    );
}
