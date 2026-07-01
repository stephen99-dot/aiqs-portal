import React from 'react';

// Consistent SVG icon set — replaces all emojis throughout portal
// All icons accept size (default 18) and color (default currentColor)

const Icon = ({ children, size = 18, color = 'currentColor', style, className, ...props }) => (
  <svg
    width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke={color} strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round"
    style={{ flexShrink: 0, ...style }}
    className={className}
    {...props}
  >
    {children}
  </svg>
);

// Navigation
export const DashboardIcon = (p) => <Icon {...p}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></Icon>;
export const NewProjectIcon = (p) => <Icon {...p}><path d="M12 5v14M5 12h14"/></Icon>;
export const PipelineIcon = (p) => <Icon {...p}><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></Icon>;
export const ClientsIcon = (p) => <Icon {...p}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></Icon>;
export const ChatIcon = (p) => <Icon {...p}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></Icon>;
export const AdminIcon = (p) => <Icon {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></Icon>;
export const RatesIcon = (p) => <Icon {...p}><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></Icon>;

// Status & Indicators
export const CheckCircleIcon = (p) => <Icon {...p}><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></Icon>;
export const ClockIcon = (p) => <Icon {...p}><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></Icon>;
export const AlertCircleIcon = (p) => <Icon {...p}><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></Icon>;
export const BanIcon = (p) => <Icon {...p}><circle cx="12" cy="12" r="10"/><path d="M4.93 4.93l14.14 14.14"/></Icon>;
export const ZapIcon = (p) => <Icon {...p}><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill={p?.filled ? p.color || 'currentColor' : 'none'}/></Icon>;

// Actions
export const UploadIcon = (p) => <Icon {...p}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/></Icon>;
export const DownloadIcon = (p) => <Icon {...p}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/></Icon>;
export const ExternalLinkIcon = (p) => <Icon {...p}><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></Icon>;
export const TrashIcon = (p) => <Icon {...p}><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></Icon>;
export const XIcon = (p) => <Icon {...p}><path d="M18 6L6 18M6 6l12 12"/></Icon>;
export const ArrowRightIcon = (p) => <Icon {...p}><path d="M5 12h14M12 5l7 7-7 7"/></Icon>;
export const ArrowLeftIcon = (p) => <Icon {...p}><path d="M19 12H5M12 19l-7-7 7-7"/></Icon>;
export const ChevronRightIcon = (p) => <Icon {...p}><path d="M9 18l6-6-6-6"/></Icon>;
export const MenuIcon = (p) => <Icon {...p}><path d="M3 12h18M3 6h18M3 18h18"/></Icon>;

// Files
export const FileTextIcon = (p) => <Icon {...p}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></Icon>;
export const FileSpreadsheetIcon = (p) => <Icon {...p}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M8 13h2M8 17h2M14 13h2M14 17h2"/></Icon>;
export const FileImageIcon = (p) => <Icon {...p}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><circle cx="10" cy="13" r="2"/><path d="M20 17l-1.09-1.09a2 2 0 00-2.82 0L10 22"/></Icon>;
export const FileArchiveIcon = (p) => <Icon {...p}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M10 12h1M10 16h1M10 20h1"/></Icon>;
export const FilePenIcon = (p) => <Icon {...p}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></Icon>;
export const RulerIcon = (p) => <Icon {...p}><path d="M21.73 18l-8-14a2 2 0 00-3.48 0l-8 14A2 2 0 004 21h16a2 2 0 001.73-3z"/></Icon>;
export const PaperclipIcon = (p) => <Icon {...p}><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></Icon>;

// Objects / Concepts
export const BuildingIcon = (p) => <Icon {...p}><path d="M6 22V4a2 2 0 012-2h8a2 2 0 012 2v18zM6 12H4a2 2 0 00-2 2v6a2 2 0 002 2h2M18 9h2a2 2 0 012 2v9a2 2 0 01-2 2h-2M10 6h4M10 10h4M10 14h4M10 18h4"/></Icon>;
export const CreditCardIcon = (p) => <Icon {...p}><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></Icon>;
export const StarIcon = (p) => <Icon {...p}><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill={p?.filled ? p.color || 'currentColor' : 'none'}/></Icon>;
export const CrownIcon = (p) => <Icon {...p}><path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7zM3 20h18"/></Icon>;
export const MailIcon = (p) => <Icon {...p}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><path d="M22 6l-10 7L2 6"/></Icon>;
export const SettingsIcon = (p) => <Icon {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></Icon>;
export const LogOutIcon = (p) => <Icon {...p}><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></Icon>;
export const SunIcon = (p) => <Icon {...p}><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></Icon>;
export const MoonIcon = (p) => <Icon {...p}><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></Icon>;
export const SearchIcon = (p) => <Icon {...p}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></Icon>;
export const TrendingUpIcon = (p) => <Icon {...p}><path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/></Icon>;
export const BarChartIcon = (p) => <Icon {...p}><path d="M12 20V10M18 20V4M6 20v-4"/></Icon>;
export const FolderIcon = (p) => <Icon {...p}><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></Icon>;
export const MapPinIcon = (p) => <Icon {...p}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></Icon>;
export const CalendarIcon = (p) => <Icon {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></Icon>;
export const InfoIcon = (p) => <Icon {...p}><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></Icon>;
export const HelpCircleIcon = (p) => <Icon {...p}><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01"/></Icon>;
export const CopyIcon = (p) => <Icon {...p}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></Icon>;
export const RefreshIcon = (p) => <Icon {...p}><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></Icon>;
export const SparklesIcon = (p) => <Icon {...p}><path d="M12 3l1.912 5.813a2 2 0 001.275 1.275L21 12l-5.813 1.912a2 2 0 00-1.275 1.275L12 21l-1.912-5.813a2 2 0 00-1.275-1.275L3 12l5.813-1.912a2 2 0 001.275-1.275L12 3z" fill={p?.filled ? p.color || 'currentColor' : 'none'}/></Icon>;
export const LayersIcon = (p) => <Icon {...p}><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></Icon>;
export const HashIcon = (p) => <Icon {...p}><path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18"/></Icon>;
export const EyeIcon = (p) => <Icon {...p}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></Icon>;
export const PackageIcon = (p) => <Icon {...p}><path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></Icon>;

// Filled status dots (for paid/unpaid indicators)
export const DotIcon = ({ size = 8, color = 'currentColor', style, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 8 8" style={{ flexShrink: 0, ...style }} {...props}>
    <circle cx="4" cy="4" r="4" fill={color} />
  </svg>
);

// ─── Emoji-replacement icons (added to retire every emoji from the UI) ──────────
// All share the same thin-line house style via <Icon>.

// Status / feedback
export const CheckIcon = (p) => <Icon {...p}><path d="M20 6L9 17l-5-5"/></Icon>;
export const XCircleIcon = (p) => <Icon {...p}><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></Icon>;
export const AlertTriangleIcon = (p) => <Icon {...p}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><path d="M12 9v4M12 17h.01"/></Icon>;
export const LightbulbIcon = (p) => <Icon {...p}><path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 00-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0012 2z"/></Icon>;
export const PartyIcon = (p) => <Icon {...p}><path d="M2 22l5-14 9 9-14 5z"/><path d="M14 8a3 3 0 00-3-3M19 5a3 3 0 00-3-3M19 11a3 3 0 013 3M12 2l.01 0M22 8l.01 0M16 16l.01 0"/></Icon>;
export const HandIcon = (p) => <Icon {...p}><path d="M18 11V6a2 2 0 00-4 0M14 6V4a2 2 0 00-4 0v2M10 6.5a2 2 0 00-4 0V13"/><path d="M18 11a6 6 0 01-12 0v-1a2 2 0 014 0"/></Icon>;

// People
export const UserIcon = (p) => <Icon {...p}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></Icon>;

// Documents / data
export const ClipboardIcon = (p) => <Icon {...p}><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/></Icon>;
export const EditIcon = (p) => <Icon {...p}><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></Icon>;
export const BookIcon = (p) => <Icon {...p}><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></Icon>;
export const ImageIcon = (p) => <Icon {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></Icon>;
export const InboxIcon = (p) => <Icon {...p}><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></Icon>;
export const ScaleIcon = (p) => <Icon {...p}><path d="M12 3v18M7 21h10M5 7h14M5 7l-3 7a4 4 0 006 0zM19 7l-3 7a4 4 0 006 0z"/></Icon>;

// Money
export const PoundIcon = (p) => <Icon {...p}><path d="M7 21h11M7 21c1.8-1.2 2.5-3 2.5-5.5V8.5A4.5 4.5 0 0118 5.6M6.5 13H14"/></Icon>;
export const CoinsIcon = (p) => <Icon {...p}><circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1110.34 18M7 6h1v4M16.71 13.88l.7.71-2.83 2.82"/></Icon>;

// Security
export const KeyIcon = (p) => <Icon {...p}><circle cx="7.5" cy="15.5" r="5.5"/><path d="M11.4 11.6L21 2M16 7l3 3M18 5l2 2"/></Icon>;
export const LockIcon = (p) => <Icon {...p}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></Icon>;

// Comms / links
export const PhoneIcon = (p) => <Icon {...p}><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0122 16.92z"/></Icon>;
export const LinkIcon = (p) => <Icon {...p}><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></Icon>;

// Brain / AI
export const BrainIcon = (p) => <Icon {...p}><path d="M9.5 2A2.5 2.5 0 0112 4.5v15a2.5 2.5 0 01-4.96.44 2.5 2.5 0 01-2.96-3.08 3 3 0 01-.34-5.58 2.5 2.5 0 011.32-4.24A2.5 2.5 0 017.5 3 2.5 2.5 0 019.5 2z"/><path d="M14.5 2A2.5 2.5 0 0012 4.5v15a2.5 2.5 0 004.96.44 2.5 2.5 0 002.96-3.08 3 3 0 00.34-5.58 2.5 2.5 0 00-1.32-4.24A2.5 2.5 0 0016.5 3 2.5 2.5 0 0014.5 2z"/></Icon>;

// Trades / construction / calculators
export const CalculatorIcon = (p) => <Icon {...p}><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/></Icon>;
export const WrenchIcon = (p) => <Icon {...p}><path d="M14.7 6.3a4 4 0 00-5.6 5.6L3 18l3 3 6.1-6.1a4 4 0 005.6-5.6l-2.9 2.9-2.1-.5-.5-2.1 2.9-2.9z"/></Icon>;
export const BrickIcon = (p) => <Icon {...p}><rect x="2" y="5" width="20" height="14" rx="1"/><path d="M2 12h20M9 5v3.5M15 5v3.5M9 12v7M15 12v7M2 8.5h7M15 8.5h7M9 15.5h6"/></Icon>;
export const CubeIcon = (p) => <Icon {...p}><path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/></Icon>;
export const BucketIcon = (p) => <Icon {...p}><path d="M5 8h14l-1.3 12.2a2 2 0 01-2 1.8H8.3a2 2 0 01-2-1.8z"/><path d="M3.5 8a8.5 3 0 0117 0"/></Icon>;
export const HomeIcon = (p) => <Icon {...p}><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M9 22V12h6v10"/></Icon>;
export const PaletteIcon = (p) => <Icon {...p}><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c1.66 0 3-1.34 3-3 0-.78-.3-1.5-.8-2-.48-.5-.78-1.22-.78-2 0-1.66 1.34-3 3-3h1.78C20.55 12 22 10.55 22 8.78 22 4.4 17.6 2 12 2z"/><circle cx="8.5" cy="7.5" r="1.2" fill="currentColor"/><circle cx="6.5" cy="12.5" r="1.2" fill="currentColor"/><circle cx="13.5" cy="6.5" r="1.2" fill="currentColor"/><circle cx="17" cy="10.5" r="1.2" fill="currentColor"/></Icon>;
export const PlankIcon = (p) => <Icon {...p}><rect x="2" y="8" width="20" height="8" rx="4"/><path d="M6 8v8M5 10.5a2 1.5 0 002 0M5 13.5a2 1.5 0 002 0"/></Icon>;
export const DropletIcon = (p) => <Icon {...p}><path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z"/></Icon>;
export const BoltIcon = (p) => <Icon {...p}><path d="M12 2.5l7 4v7l-7 4-7-4v-7z"/><circle cx="12" cy="10" r="2.5"/></Icon>;
export const PlugIcon = (p) => <Icon {...p}><path d="M9 2v6M15 2v6M6 8h12v2a6 6 0 01-12 0z"/><path d="M12 16v6"/></Icon>;
export const ThermometerIcon = (p) => <Icon {...p}><path d="M14 14.76V3.5a2.5 2.5 0 00-5 0v11.26a4.5 4.5 0 105 0z"/></Icon>;
export const PickaxeIcon = (p) => <Icon {...p}><path d="M11 13L3 21M5.5 7.5C9 5 15 5 18.5 7.5M16.5 16.5C19 13 19 9 16.5 5.5M11 13l4-4"/></Icon>;
export const FryingPanIcon = (p) => <Icon {...p}><circle cx="10" cy="13" r="7"/><path d="M17 13h6"/></Icon>;
export const BurstIcon = (p) => <Icon {...p}><path d="M12 2l2.4 5.2L20 6l-2.8 5L22 13l-5.6 1L17 20l-5-3-5 3 .6-6L2 13l4.8-2L4 6l5.6 1.2z"/></Icon>;
export const ShopIcon = (p) => <Icon {...p}><path d="M3 9l1.5-5h15L21 9M4 9v11a1 1 0 001 1h14a1 1 0 001-1V9M3 9h18M9 21v-6h6v6"/></Icon>;

// ─── Brand marks ────────────────────────────────────────────────────────────
// Xero logo: a blue disc with a white "x". Rendered from its own <svg> (not the
// thin-line Icon wrapper) so it keeps Xero's brand blue and filled shape.
export const XeroMark = ({ size = 24, style, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" style={{ flexShrink: 0, ...style }} {...props}>
    <circle cx="24" cy="24" r="24" fill="#13B5EA" />
    <g stroke="#fff" strokeWidth="3.6" strokeLinecap="round">
      <path d="M17 17.5 L31 30.5" />
      <path d="M31 17.5 L17 30.5" />
    </g>
  </svg>
);
