import type { SVGProps } from "react";

export type IconName =
  | "archive"
  | "arrow-up-right"
  | "bookmark"
  | "check"
  | "chevron-down"
  | "chevron-right"
  | "command"
  | "folder"
  | "grid"
  | "history"
  | "layers"
  | "menu"
  | "moon"
  | "monitor"
  | "plus"
  | "refresh"
  | "search"
  | "settings"
  | "spark"
  | "sun"
  | "terminal"
  | "x";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
  /** Supplying a label makes the icon meaningful to assistive technology. */
  label?: string;
}

interface IconPathProps {
  name: IconName;
}

function IconPath({ name }: IconPathProps) {
  switch (name) {
    case "archive":
      return <path d="M4 7.5h16M5.5 7.5v10A1.5 1.5 0 0 0 7 19h10a1.5 1.5 0 0 0 1.5-1.5v-10M3 4.5h18v3H3zM9 12h6" />;
    case "arrow-up-right":
      return <path d="M7 17 17 7M8 7h9v9" />;
    case "bookmark":
      return <path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-3.6L6 21z" />;
    case "check":
      return <path d="m5 12 4.3 4.3L19 6.7" />;
    case "chevron-down":
      return <path d="m6 9 6 6 6-6" />;
    case "chevron-right":
      return <path d="m9 6 6 6-6 6" />;
    case "command":
      return <path d="M18 9a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3z" />;
    case "folder":
      return <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h5l2 2h7A1.5 1.5 0 0 1 20.5 8.5v8A1.5 1.5 0 0 1 19 18H5a1.5 1.5 0 0 1-1.5-1.5z" />;
    case "grid":
      return <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />;
    case "history":
      return <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6M3.5 5v5h5M12 7.5V12l3 2" />;
    case "layers":
      return <path d="m12 3 8 4.5-8 4.5-8-4.5zM4 12l8 4.5 8-4.5M4 16.5l8 4.5 8-4.5" />;
    case "menu":
      return <path d="M4 7h16M4 12h16M4 17h16" />;
    case "moon":
      return <path d="M19 14.5A7.5 7.5 0 0 1 9.5 5 7.5 7.5 0 1 0 19 14.5z" />;
    case "monitor":
      return <path d="M4 4.5h16A1.5 1.5 0 0 1 21.5 6v9A1.5 1.5 0 0 1 20 16.5H4A1.5 1.5 0 0 1 2.5 15V6A1.5 1.5 0 0 1 4 4.5zM8 20h8M12 16.5V20" />;
    case "plus":
      return <path d="M12 5v14M5 12h14" />;
    case "refresh":
      return <path d="M19 8a7.5 7.5 0 0 0-13.2-1.7L4 8.5M4 4.5v4h4M5 16a7.5 7.5 0 0 0 13.2 1.7l1.8-2.2M20 19.5v-4h-4" />;
    case "search":
      return <path d="m20 20-4.3-4.3M10.8 17a6.2 6.2 0 1 0 0-12.4 6.2 6.2 0 0 0 0 12.4z" />;
    case "settings":
      return <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM19.4 13.5a7.6 7.6 0 0 0 0-3l1.5-1.1-1.8-3.1-1.8.7a7.7 7.7 0 0 0-2.6-1.5L14.4 3h-3.6l-.3 2.5a7.7 7.7 0 0 0-2.6 1.5l-1.8-.7-1.8 3.1 1.5 1.1a7.6 7.6 0 0 0 0 3l-1.5 1.1 1.8 3.1 1.8-.7a7.7 7.7 0 0 0 2.6 1.5l.3 2.5h3.6l.3-2.5a7.7 7.7 0 0 0 2.6-1.5l1.8.7 1.8-3.1z" />;
    case "spark":
      return <path d="m12 3 1.3 5.7L19 10l-5.7 1.3L12 17l-1.3-5.7L5 10l5.7-1.3zM19 16l.6 2.4L22 19l-2.4.6L19 22l-.6-2.4L16 19l2.4-.6z" />;
    case "sun":
      return <path d="M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M16.5 12a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0z" />;
    case "terminal":
      return <path d="m4 5 6 6-6 6M12 17h8" />;
    case "x":
      return <path d="m6 6 12 12M18 6 6 18" />;
    default:
      return null;
  }
}

export function Icon({ name, size = 18, label, ...props }: IconProps) {
  return (
    <svg
      aria-hidden={label ? undefined : true}
      aria-label={label}
      fill="none"
      height={size}
      role={label ? "img" : undefined}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      <IconPath name={name} />
    </svg>
  );
}
