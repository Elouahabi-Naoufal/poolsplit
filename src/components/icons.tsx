type IconProps = {
  size?: number;
  className?: string;
};

function Base({ size = 16, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function IconBack({ size, className }: IconProps) {
  return (
    <Base size={size} className={className}>
      <path d="M15 18l-6-6 6-6" />
    </Base>
  );
}

export function IconChevronRight({ size, className }: IconProps) {
  return (
    <Base size={size} className={className}>
      <path d="M9 18l6-6-6-6" />
    </Base>
  );
}

export function IconChevronDown({ size, className }: IconProps) {
  return (
    <Base size={size} className={className}>
      <path d="M6 9l6 6 6-6" />
    </Base>
  );
}

export function IconPlus({ size, className }: IconProps) {
  return (
    <Base size={size} className={className}>
      <path d="M12 5v14M5 12h14" />
    </Base>
  );
}

export function IconCheck({ size, className }: IconProps) {
  return (
    <Base size={size} className={className}>
      <path d="M20 6L9 17l-5-5" />
    </Base>
  );
}

export function IconX({ size, className }: IconProps) {
  return (
    <Base size={size} className={className}>
      <path d="M18 6L6 18M6 6l12 12" />
    </Base>
  );
}

export function IconPencil({ size, className }: IconProps) {
  return (
    <Base size={size} className={className}>
      <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </Base>
  );
}

export function IconUsers({ size, className }: IconProps) {
  return (
    <Base size={size} className={className}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </Base>
  );
}

export function IconReceipt({ size, className }: IconProps) {
  return (
    <Base size={size} className={className}>
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z" />
      <path d="M8 7h8M8 11h8M8 15h5" />
    </Base>
  );
}

export function IconQr({ size, className }: IconProps) {
  return (
    <Base size={size} className={className}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM21 14v.01M14 21v.01M18 18h3v3h-3z" />
    </Base>
  );
}

export function IconTemplate({ size, className }: IconProps) {
  return (
    <Base size={size} className={className}>
      <path d="M4 3h16v18H4z" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </Base>
  );
}

export function IconArrowRight({ size, className }: IconProps) {
  return (
    <Base size={size} className={className}>
      <path d="M5 12h14M12 5l7 7-7 7" />
    </Base>
  );
}


export function IconGlobe({ size, className }: IconProps) {
  return (
    <Base size={size} className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </Base>
  );
}

export function IconSun({ size, className }: IconProps) {
  return (
    <Base size={size} className={className}>
      <circle cx="12" cy="12" r="5" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </Base>
  );
}

export function IconMoon({ size, className }: IconProps) {
  return (
    <Base size={size} className={className}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </Base>
  );
}

export function IconSearch({ size, className }: IconProps) {
  return (
    <Base size={size} className={className}>
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </Base>
  );
}

export function IconFilter({ size, className }: IconProps) {
  return (
    <Base size={size} className={className}>
      <path d="M3 6h18M6 12h12M10 18h4" />
    </Base>
  );
}

export function IconDownload({ size, className }: IconProps) {
  return (
    <Base size={size} className={className}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
    </Base>
  );
}

export function IconShare({ size, className }: IconProps) {
  return (
    <Base size={size} className={className}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98" />
    </Base>
  );
}
