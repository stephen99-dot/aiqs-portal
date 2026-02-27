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
