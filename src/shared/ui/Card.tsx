import React from "react";

interface CardProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  as?: "section" | "div" | "article";
  title?: React.ReactNode;
  action?: React.ReactNode;
  padded?: boolean;
}

export function Card({ as = "section", title, action, padded = true, className = "", children, ...rest }: CardProps) {
  const Tag = as;
  return (
    <Tag className={`bg-white rounded-card shadow-card border border-soil-100 ${padded ? "p-4" : ""} ${className}`} {...rest}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-2 mb-3">
          {title && <h2 className="font-display font-semibold text-base text-soil-900">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </Tag>
  );
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-soil-600">{label}</p>
      <p className="font-display font-bold text-xl text-soil-900 truncate">{value}</p>
      {hint && <p className="text-xs text-soil-500">{hint}</p>}
    </div>
  );
}
