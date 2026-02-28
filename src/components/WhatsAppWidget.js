import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Send, Phone, FileText, HelpCircle, Clock, ChevronRight, Zap, Upload } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════════
// WHATSAPP WIDGET — src/components/WhatsAppWidget.js
// Draggable floating WhatsApp button with chat panel and quick actions
// ═══════════════════════════════════════════════════════════════════════════════

const WHATSAPP_NUMBER = '447534808399';
const WHATSAPP_DISPLAY = '+44 7534 808 399';

const QUICK_ACTIONS = [
  {
    icon: FileText,
    label: 'Get a Quote',
    message: "Hi, I'd like to get a quote for a new construction project. Can you help?",
    color: '#2563EB',
  },
  {
    icon: HelpCircle,
    label: 'Question About My BOQ',
    message: "Hi, I have a question about my Bill of Quantities. Can we discuss?",
    color: '#8B5CF6',
  },
  {
    icon: Upload,
    label: 'Send My Drawings',
    message: "Hi, I'd like to send my drawings for a BOQ. What's the best way to get started?",
    color: '#F59E0B',
  },
  {
    icon: Zap,
    label: 'Urgent Request',
    message: "Hi, I have an urgent request regarding a project. Are you available?",
    color: '#EF4444',
  },
];

function openWhatsApp(message = '') {
  const encoded = encodeURIComponent(message);
  window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encoded}`, '_blank');
}

export default function WhatsAppWidget({ theme, userName }) {
  const [isOpen, setIsOpen] = useState(false);
  const [customMessage, setCustomMessage] = useState('');
  const [showPulse, setShowPulse] = useState(true);
  const [bottomPos, setBottomPos] = useState(24);
  const dragging = useRef(false);
  const moved = useRef(false);
  const startY = useRef(0);
  const startBottom = useRef(24);
  const widgetRef = useRef(null);

  const isDark = theme?.bg === '#06080F' || (theme?.bg && theme?.bg.includes('0'));

  useEffect(() => {
    if (isOpen) setShowPulse(false);
  }, [isOpen]);

  // Drag handlers
  const onDragStart = useCallback((clientY) => {
    dragging.current = true;
    moved.current = false;
    startY.current = clientY;
    startBottom.current = bottomPos;
  }, [bottomPos]);

  const onDragMove = useCallback((clientY) => {
    if (!dragging.current) return;
    const dy = startY.current - clientY;
    if (Math.abs(dy) > 8) {
      moved.current = true;
      const newBottom = Math.max(8, Math.min(window.innerHeight - 90, startBottom.current + dy));
      setBottomPos(newBottom);
    }
  }, []);

  const onDragEnd = useCallback(() => {
    dragging.current = false;
  }, []);

  useEffect(() => {
    const handleMouseMove = (e) => onDragMove(e.clientY);
    const handleTouchMove = (e) => onDragMove(e.touches[0].clientY);
    const handleEnd = () => onDragEnd();

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchend', handleEnd);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchend', handleEnd);
    };
  }, [onDragMove, onDragEnd]);

  const handleButtonClick = () => {
    if (moved.current) {
      moved.current = false;
      return;
    }
    setIsOpen(!isOpen);
  };

  const handleSendCustom = () => {
    if (customMessage.trim()) {
      openWhatsApp(customMessage.trim());
      setCustomMessage('');
      setIsOpen(false);
    }
  };

  return (
    <div
      ref={widgetRef}
      style={{
        position: 'fixed', bottom: bottomPos, right: 24, zIndex: 9998,
      }}
    >
      {/* ─── Chat Panel ──────────────────────────────────────────────── */}
      {isOpen && (
        <div style={{
          position: 'absolute', bottom: 68, right: 0,
          width: 360, maxHeight: 520,
          background: isDark ? '#131B2E' : '#FFFFFF',
          border: `1px solid ${isDark ? '#1C2A44' : '#E2E8F0'}`,
          borderRadius: 20,
          boxShadow: '0 16px 48px rgba(0,0,0,0.3)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          animation: 'waSlideUp 0.3s cubic-bezier(0.16,1,0.3,1)',
        }}>
          {/* Header */}
          <div style={{
            background: '#25D366',
            padding: '18px 20px',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <div style={{
              width: 42, height: 42, borderRadius: '50%',
              background: 'rgba(255,255,255,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#FFF' }}>AI QS</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#FFF', display: 'inline-block' }} />
                Usually replies within 1 hour
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} style={{
              background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '50%',
              width: 32, height: 32, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <X size={16} style={{ color: '#FFF' }} />
            </button>
          </div>

          {/* Chat Body */}
          <div style={{
            flex: 1, padding: 16, overflowY: 'auto',
            background: isDark ? '#0A0F1C' : '#F0F2F5',
          }}>
            <div style={{
              background: isDark ? '#1C2A44' : '#FFFFFF',
              borderRadius: '4px 12px 12px 12px',
              padding: '12px 16px', marginBottom: 16, maxWidth: '85%',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            }}>
              <p style={{ margin: 0, fontSize: 14, color: isDark ? '#E8EDF5' : '#1A1A2E', lineHeight: 1.5 }}>
                Hey{userName ? ` ${userName.split(' ')[0]}` : ''}! 👋
              </p>
              <p style={{ margin: '8px 0 0', fontSize: 14, color: isDark ? '#94A3B8' : '#64748B', lineHeight: 1.5 }}>
                How can I help? Pick a quick action below or type your own message.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {QUICK_ACTIONS.map((action, i) => (
                <button
                  key={i}
                  onClick={() => { openWhatsApp(action.message); setIsOpen(false); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 16px', borderRadius: 12,
                    background: isDark ? '#131B2E' : '#FFFFFF',
                    border: `1px solid ${isDark ? '#1C2A44' : '#E2E8F0'}`,
                    cursor: 'pointer', textAlign: 'left',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = action.color;
                    e.currentTarget.style.background = isDark ? '#182036' : '#F8FAFC';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = isDark ? '#1C2A44' : '#E2E8F0';
                    e.currentTarget.style.background = isDark ? '#131B2E' : '#FFFFFF';
                  }}
                >
                  <div style={{
                    width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                    background: `${action.color}15`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <action.icon size={18} style={{ color: action.color }} />
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 600, color: isDark ? '#E8EDF5' : '#0F172A', flex: 1 }}>
                    {action.label}
                  </span>
                  <ChevronRight size={14} style={{ color: isDark ? '#3B4D66' : '#CBD5E1' }} />
                </button>
              ))}
            </div>
          </div>

          {/* Custom Message Input */}
          <div style={{
            padding: '12px 16px',
            borderTop: `1px solid ${isDark ? '#1C2A44' : '#E2E8F0'}`,
            background: isDark ? '#131B2E' : '#FFFFFF',
            display: 'flex', gap: 8, alignItems: 'center',
          }}>
            <input
              type="text"
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendCustom()}
              placeholder="Type a message..."
              style={{
                flex: 1, padding: '10px 14px', borderRadius: 20,
                border: `1px solid ${isDark ? '#1C2A44' : '#E2E8F0'}`,
                background: isDark ? '#0D1320' : '#F8FAFC',
                color: isDark ? '#E8EDF5' : '#0F172A',
                fontSize: 14, outline: 'none',
              }}
            />
            <button
              onClick={handleSendCustom}
              disabled={!customMessage.trim()}
              style={{
                width: 40, height: 40, borderRadius: '50%',
                background: customMessage.trim() ? '#25D366' : (isDark ? '#1C2A44' : '#E2E8F0'),
                border: 'none', cursor: customMessage.trim() ? 'pointer' : 'default',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'background 0.2s',
              }}
            >
              <Send size={16} style={{ color: customMessage.trim() ? '#FFF' : (isDark ? '#3B4D66' : '#94A3B8') }} />
            </button>
          </div>

          {/* Footer */}
          <div style={{
            padding: '8px 16px 12px', textAlign: 'center',
            borderTop: `1px solid ${isDark ? '#0D1320' : '#F1F5F9'}`,
          }}>
            <a
              href={`tel:+${WHATSAPP_NUMBER}`}
              style={{
                fontSize: 11, color: isDark ? '#3B4D66' : '#94A3B8',
                textDecoration: 'none', display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: 4,
              }}
            >
              <Phone size={10} /> {WHATSAPP_DISPLAY} · Prefer a call? Tap to ring
            </a>
          </div>
        </div>
      )}

      {/* ─── Floating Button (Draggable) ─────────────────────────────── */}
      <div
        onClick={handleButtonClick}
        onMouseDown={(e) => { e.preventDefault(); onDragStart(e.clientY); }}
        onTouchStart={(e) => onDragStart(e.touches[0].clientY)}
        style={{
          width: 56, height: 56, borderRadius: '50%',
          background: '#25D366',
          border: 'none', cursor: 'grab',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 16px rgba(37,211,102,0.4)',
          transition: dragging.current ? 'none' : 'transform 0.2s, box-shadow 0.2s',
          userSelect: 'none', touchAction: 'none',
          position: 'relative',
        }}
        onMouseEnter={(e) => { if (!dragging.current) { e.currentTarget.style.transform = 'scale(1.08)'; e.currentTarget.style.boxShadow = '0 6px 24px rgba(37,211,102,0.5)'; }}}
        onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(37,211,102,0.4)'; }}
      >
        {isOpen ? (
          <X size={24} style={{ color: '#FFF', pointerEvents: 'none' }} />
        ) : (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="white" style={{ pointerEvents: 'none' }}>
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
          </svg>
        )}

        {showPulse && !isOpen && (
          <span style={{
            position: 'absolute', inset: -4,
            borderRadius: '50%',
            border: '2px solid #25D366',
            animation: 'waPulse 2s ease-in-out infinite',
            pointerEvents: 'none',
          }} />
        )}
      </div>

      <style>{`
        @keyframes waSlideUp {
          from { opacity: 0; transform: translateY(16px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes waPulse {
          0%, 100% { transform: scale(1); opacity: 0.6; }
          50% { transform: scale(1.3); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
