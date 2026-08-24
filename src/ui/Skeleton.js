import React from 'react';

// Shimmer placeholders shown while data loads — sized like the content they
// stand in for, so the page doesn't jump when it arrives.
//
//   <Skeleton width={180} height={14} />
//   <SkeletonRows rows={4} />          // list-row placeholders inside a Card
export default function Skeleton({ width = '100%', height = 14, radius = 6, style, className = '', ...rest }) {
  return (
    <span
      className={`ui-skeleton ${className}`.trim()}
      style={{ width, height, borderRadius: radius, ...style }}
      aria-hidden="true"
      {...rest}
    />
  );
}

export function SkeletonRows({ rows = 3, ...rest }) {
  return (
    <div aria-hidden="true" {...rest}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="ui-row">
          <div className="ui-row__main">
            <Skeleton width={`${52 - (i % 3) * 9}%`} height={14} style={{ marginBottom: 7 }} />
            <Skeleton width={`${30 - (i % 2) * 8}%`} height={10} />
          </div>
          <Skeleton width={72} height={22} radius={6} />
        </div>
      ))}
    </div>
  );
}

// Card-shaped placeholder for grid layouts (e.g. the Jobs board).
export function SkeletonCard({ height = 96, ...rest }) {
  return (
    <div className="ui-card ui-card--flat" style={{ padding: '14px 16px' }} aria-hidden="true" {...rest}>
      <Skeleton width="55%" height={15} style={{ marginBottom: 9 }} />
      <Skeleton width="35%" height={11} style={{ marginBottom: height > 80 ? 16 : 0 }} />
      {height > 80 && <Skeleton width="100%" height={12} />}
    </div>
  );
}
