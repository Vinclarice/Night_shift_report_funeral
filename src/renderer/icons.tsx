import type { SVGProps } from "react";

/**
 * Small hand-authored line icons for the editor chrome (header actions, entry-list actions).
 * Kept dependency-free and deliberately minimal — plain strokes, no fills, 24x24 viewBox —
 * so they read cleanly at 15-16px next to button labels without pulling in an icon library.
 * These never appear in the printed report; that surface stays untouched.
 */
function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="icon"
      aria-hidden="true"
      {...props}
    />
  );
}

export function IconUndo(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M7 7 3 11l4 4" />
      <path d="M3 11h11a6 6 0 0 1 0 12h-2" />
    </Icon>
  );
}

export function IconRedo(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M17 7l4 4-4 4" />
      <path d="M21 11H10a6 6 0 0 0 0 12h2" />
    </Icon>
  );
}

export function IconBuilding(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="4" y="3" width="11" height="18" rx="1" />
      <path d="M9 21v-4h1v4M15 8h5v13h-5" />
      <path d="M7.5 7h2M7.5 10.5h2M7.5 14h2" />
    </Icon>
  );
}

export function IconHistory(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 11a9 9 0 1 0 2.6-6.3" />
      <path d="M3 4v5h5" />
      <path d="M12 8v4l3 2" />
    </Icon>
  );
}

export function IconSliders(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 6h9M17 6h3" />
      <path d="M4 12h3M11 12h9" />
      <path d="M4 18h13M21 18" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="7" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </Icon>
  );
}

export function IconCheck(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 12.5 9.5 18 20 6" />
    </Icon>
  );
}

export function IconPrinter(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M6 9V3h12v6" />
      <rect x="3.5" y="9" width="17" height="8" rx="1.5" />
      <path d="M6 15h12v6H6z" />
    </Icon>
  );
}

export function IconPencil(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 20h4L19.5 8.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 15.5z" />
      <path d="M14 6.5l3.5 3.5" />
    </Icon>
  );
}

export function IconTrash(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4.5 7h15" />
      <path d="M8 7V4.5h8V7" />
      <path d="M6.5 7 7.3 20a1 1 0 0 0 1 1h7.4a1 1 0 0 0 1-1L17.5 7" />
      <path d="M10 11v6M14 11v6" />
    </Icon>
  );
}

export function IconX(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="m5 5 14 14M19 5 5 19" />
    </Icon>
  );
}

export function IconPlus(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

export function IconMinus(props: SVGProps<SVGSVGElement>) {
  return <Icon {...props}><path d="M5 12h14" /></Icon>;
}

export function IconSidebar(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16M18 9h1M18 12h1" />
    </Icon>
  );
}

export function IconWand(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="m4 20 11-11M13 4l1-2 1 2 2 1-2 1-1 2-1-2-2-1zM18 13l.8-1.6.8 1.6 1.6.8-1.6.8-.8 1.6-.8-1.6-1.6-.8z" />
      <path d="m6 14 4 4" />
    </Icon>
  );
}

export function IconArchive(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
      <path d="M10 12h4" />
    </Icon>
  );
}

export function IconSearch(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 4 4" />
    </Icon>
  );
}

export function IconArrowLeft(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M19 12H5" />
      <path d="m11 6-6 6 6 6" />
    </Icon>
  );
}

/* Window controls. Square caps and a 1.4 stroke match the Windows 11 title-bar glyph metrics. */
function ChromeIcon(props: SVGProps<SVGSVGElement>) {
  return <Icon viewBox="0 0 12 12" width={12} height={12} strokeWidth={1.15} strokeLinecap="butt" strokeLinejoin="miter" {...props} />;
}

export function IconChromeMinimize(props: SVGProps<SVGSVGElement>) {
  return <ChromeIcon {...props}><path d="M1.5 6h9" /></ChromeIcon>;
}

export function IconChromeMaximize(props: SVGProps<SVGSVGElement>) {
  return <ChromeIcon {...props}><rect x="1.7" y="1.7" width="8.6" height="8.6" rx="0.6" /></ChromeIcon>;
}

export function IconChromeRestore(props: SVGProps<SVGSVGElement>) {
  return (
    <ChromeIcon {...props}>
      <rect x="1.5" y="3.5" width="7" height="7" rx="0.6" />
      <path d="M3.9 3.4V2.1a.6.6 0 0 1 .6-.6h5.4a.6.6 0 0 1 .6.6v5.4a.6.6 0 0 1-.6.6H9.2" />
    </ChromeIcon>
  );
}

export function IconChromeClose(props: SVGProps<SVGSVGElement>) {
  return <ChromeIcon {...props}><path d="m2.2 2.2 7.6 7.6M9.8 2.2 2.2 9.8" /></ChromeIcon>;
}
