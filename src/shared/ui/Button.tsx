import React from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "steel";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: React.ReactNode;
  block?: boolean;
}

const variantClasses: Record<Variant, string> = {
  primary: "bg-leaf-600 text-white hover:bg-leaf-700 active:bg-leaf-800 disabled:bg-leaf-400",
  secondary:
    "bg-white text-leaf-800 border border-soil-200 hover:bg-soil-50 active:bg-soil-100 disabled:text-soil-500",
  ghost: "bg-transparent text-leaf-700 hover:bg-leaf-50 active:bg-leaf-100 disabled:text-soil-500",
  danger: "bg-danger-600 text-white hover:brightness-110 disabled:opacity-60",
  steel: "bg-steel-600 text-white hover:bg-steel-800 disabled:bg-steel-400",
};

// 44px minimum touch target (WCAG 2.5.5) on sm, 48px on md/lg.
const sizeClasses: Record<Size, string> = {
  sm: "min-h-[44px] px-3 text-sm",
  md: "min-h-[48px] px-4 text-base",
  lg: "min-h-[52px] px-5 text-lg",
};

export function Button({
  variant = "primary",
  size = "md",
  icon,
  block,
  className = "",
  type = "button",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-tile font-display font-semibold transition-colors disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${block ? "w-full" : ""} ${className}`}
    >
      {icon && <span aria-hidden="true">{icon}</span>}
      {children}
    </button>
  );
}
