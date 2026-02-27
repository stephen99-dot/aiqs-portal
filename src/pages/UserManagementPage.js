import React, { useState, useEffect, useCallback } from 'react';
import { Users, UserPlus, Trash2, Edit3, Shield, Search, X, Check, AlertTriangle, ChevronDown, MoreVertical, Mail, Phone, Building2, Calendar, FolderOpen } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════════
// USER MANAGEMENT PAGE — src/pages/UserManagementPage.js
// ═══════════════════════════════════════════════════════════════════════════════

const API_BASE = '/api';

function getToken() {
  return localStorage.getItem('aiqs_token');
}

function apiFetch(endpoint, options = {}) {
  const token = getToken();
  return fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers,
    },
  }).then(async (res) => {
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  });
}

// ─── Add User Modal ─────────────────────────────────────────────────────────
function AddUserModal({ isOpen, onClose, onUserAdded, theme }) {
  const [form, setForm] = useState({ email: '', password: '', fullName: '', company: '', phone: '', role: 'client' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const t = theme || {};
  const isDark = t.bg === '#06080F' || (t.bg && t.bg.includes('0'));

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await apiFetch('/admin/users', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      onUserAdded(data.user);
      setForm({ email: '', password: '', fullName: '', company: '', phone: '', role: 'client' });
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px',
    }}>
      <div style={{
        background: isDark ? '#131B2E' : '#FFFFFF',
        borderRadius: 16, padding: 32, width: '100%', maxWidth: 480,
        border: `1px solid ${isDark ? '#1C2A44' : '#E2E8F0'}`,
        boxShadow: '0 24px 48px rgba(0,0,0,0.3)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: isDark ? '#E8EDF5' : '#0F172A', display: 'flex', alignItems: 'center', gap: 10 }}>
            <UserPlus size={22} style={{ color: '#2563EB' }} /> Add New User
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: isDark ? '#5A6E87' : '#94A3B8', padding: 4 }}>
            <X size={20} />
          </button>
        </div>

        {error && (
          <div style={{
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: '#EF4444', fontSize: 13,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <AlertTriangle size={14} /> {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[
            { key: 'fullName', label: 'Full Name', required: true, placeholder: 'e.g. Paul Richards' },
            { key: 'email', label: 'Email', required: true, type: 'email', placeholder: 'paul@company.com' },
            { key: 'password', label: 'Password', required: true, type: 'password', placeholder: 'Min 6 characters' },
            { key: 'company', label: 'Company', required: false, placeholder: 'e.g. Penn Contracting' },
            { key: 'phone', label: 'Phone', required: false, placeholder: '+44 7xxx xxx xxx' },
          ].map(({ key, label, required, type, placeholder }) => (
            <div key={key}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: isDark ? '#94A3B8' : '#64748B', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {label} {required && <span style={{ color: '#EF4444' }}>*</span>}
              </label>
              <input
                type={type || 'text'}
                value={form[key]}
                onChange={(e) => setForm(f => ({ ...f, [key]: e.target.value }))}
                required={required}
                placeholder={placeholder}
                style={{
                  width: '100%', padding: '10px 14px', borderRadius: 8, border: `1px solid ${isDark ? '#1C2A44' : '#E2E8F0'}`,
                  background: isDark ? '#0D1320' : '#F8FAFC', color: isDark ? '#E8EDF5' : '#0F172A',
                  fontSize: 14, outline: 'none', boxSizing: 'border-box',
                  transition: 'border-color 0.2s',
                }}
                onFocus={(e) => e.target.style.borderColor = '#2563EB'}
                onBlur={(e) => e.target.style.borderColor = isDark ? '#1C2A44' : '#E2E8F0'}
              />
            </div>
          ))}

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: isDark ? '#94A3B8' : '#64748B', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Role
            </label>
            <div style={{ display: 'flex', gap: 10 }}>
              {['client', 'admin'].map(role => (
                <button
                  key={role}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, role }))}
                  style={{
                    flex: 1, padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
                    border: `2px solid ${form.role === role ? '#2563EB' : (isDark ? '#1C2A44' : '#E2E8F0')}`,
                    background: form.role === role ? 'rgba(37,99,235,0.1)' : 'transparent',
                    color: form.role === role ? '#2563EB' : (isDark ? '#94A3B8' : '#64748B'),
                    fontSize: 13, fontWeight: 600, textTransform: 'capitalize',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    transition: 'all 0.2s',
                  }}
                >
                  {role === 'admin' && <Shield size={14} />}
                  {role === 'client' && <Users size={14} />}
                  {role}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button type="button" onClick={onClose} style={{
              flex: 1, padding: '12px', borderRadius: 10, cursor: 'pointer',
              border: `1px solid ${isDark ? '#1C2A44' : '#E2E8F0'}`, background: 'transparent',
              color: isDark ? '#94A3B8' : '#64748B', fontSize: 14, fontWeight: 600,
            }}>
              Cancel
            </button>
            <button type="submit" disabled={loading} style={{
              flex: 1, padding: '12px', borderRadius: 10, cursor: loading ? 'wait' : 'pointer',
              border: 'none', background: '#2563EB', color: '#FFFFFF',
              fontSize: 14, fontWeight: 600, opacity: loading ? 0.7 : 1,
              transition: 'opacity 0.2s',
            }}>
              {loading ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Delete Confirmation Modal ──────────────────────────────────────────────
function DeleteConfirmModal({ isOpen, user, onClose, onConfirm, theme }) {
  const isDark = theme?.bg === '#06080F' || (theme?.bg && theme?.bg.includes('0'));
  const [loading, setLoading] = useState(false);

  if (!isOpen || !user) return null;

  const handleDelete = async () => {
    setLoading(true);
    try {
      await onConfirm(user.id);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px',
    }}>
      <div style={{
        background: isDark ? '#131B2E' : '#FFFFFF',
        borderRadius: 16, padding: 32, width: '100%', maxWidth: 420,
        border: `1px solid ${isDark ? '#1C2A44' : '#E2E8F0'}`,
        boxShadow: '0 24px 48px rgba(0,0,0,0.3)',
        textAlign: 'center',
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%', background: 'rgba(239,68,68,0.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px',
        }}>
          <AlertTriangle size={28} style={{ color: '#EF4444' }} />
        </div>

        <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: isDark ? '#E8EDF5' : '#0F172A' }}>
          Delete User
        </h3>
        <p style={{ margin: '0 0 6px', fontSize: 14, color: isDark ? '#94A3B8' : '#64748B' }}>
          Are you sure you want to delete <strong style={{ color: isDark ? '#E8EDF5' : '#0F172A' }}>{user.full_name}</strong>?
        </p>
        <p style={{ margin: '0 0 24px', fontSize: 13, color: '#EF4444' }}>
          This will also delete all their projects and uploaded files. This cannot be undone.
        </p>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: '12px', borderRadius: 10, cursor: 'pointer',
            border: `1px solid ${isDark ? '#1C2A44' : '#E2E8F0'}`, background: 'transparent',
            color: isDark ? '#94A3B8' : '#64748B', fontSize: 14, fontWeight: 600,
          }}>
            Cancel
          </button>
          <button onClick={handleDelete} disabled={loading} style={{
            flex: 1, padding: '12px', borderRadius: 10, cursor: loading ? 'wait' : 'pointer',
            border: 'none', background: '#EF4444', color: '#FFFFFF',
            fontSize: 14, fontWeight: 600, opacity: loading ? 0.7 : 1,
          }}>
            {loading ? 'Deleting...' : 'Delete User'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main User Management Page ──────────────────────────────────────────────
export default function UserManagementPage({ theme }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [roleFilter, setRoleFilter] = useState('all');

  const t = theme || {};
  const isDark = t.bg === '#06080F' || (t.bg && t.bg.includes('0'));

  // Fetch users
  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiFetch('/admin/users');
      setUsers(data.users || []);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  // Delete user
  const handleDelete = async (userId) => {
    try {
      await apiFetch(`/admin/users/${userId}`, { method: 'DELETE' });
      setUsers(prev => prev.filter(u => u.id !== userId));
      setDeleteTarget(null);
    } catch (err) {
      alert('Failed to delete user: ' + err.message);
    }
  };

  // Toggle role
  const handleToggleRole = async (user) => {
    const newRole = user.role === 'admin' ? 'client' : 'admin';
    try {
      await apiFetch(`/admin/users/${user.id}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role: newRole }),
      });
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, role: newRole } : u));
    } catch (err) {
      alert('Failed to update role: ' + err.message);
    }
  };

  // Filter and search
  const filtered = users.filter(u => {
    const matchSearch = !search || 
      u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
      u.email?.toLowerCase().includes(search.toLowerCase()) ||
      u.company?.toLowerCase().includes(search.toLowerCase());
    const matchRole = roleFilter === 'all' || u.role === roleFilter;
    return matchSearch && matchRole;
  });

  const adminCount = users.filter(u => u.role === 'admin').length;
  const clientCount = users.filter(u => u.role === 'client').length;

  // Styles
  const cardStyle = {
    background: isDark ? '#131B2E' : '#FFFFFF',
    border: `1px solid ${isDark ? '#1C2A44' : '#E2E8F0'}`,
    borderRadius: 14,
    overflow: 'hidden',
  };

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: isDark ? '#E8EDF5' : '#0F172A', letterSpacing: '-0.02em' }}>
            User Management
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: isDark ? '#5A6E87' : '#94A3B8' }}>
            {users.length} total users · {adminCount} admin{adminCount !== 1 ? 's' : ''} · {clientCount} client{clientCount !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px',
            borderRadius: 10, border: 'none', background: '#2563EB', color: '#FFFFFF',
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(37,99,235,0.3)',
            transition: 'transform 0.15s, box-shadow 0.15s',
          }}
          onMouseEnter={(e) => { e.target.style.transform = 'translateY(-1px)'; e.target.style.boxShadow = '0 6px 16px rgba(37,99,235,0.4)'; }}
          onMouseLeave={(e) => { e.target.style.transform = 'translateY(0)'; e.target.style.boxShadow = '0 4px 12px rgba(37,99,235,0.3)'; }}
        >
          <UserPlus size={16} /> Add User
        </button>
      </div>

      {/* Search + Filter Bar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px',
          borderRadius: 10, border: `1px solid ${isDark ? '#1C2A44' : '#E2E8F0'}`,
          background: isDark ? '#0D1320' : '#F8FAFC',
        }}>
          <Search size={16} style={{ color: isDark ? '#5A6E87' : '#94A3B8', flexShrink: 0 }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, or company..."
            style={{
              flex: 1, padding: '11px 0', border: 'none', background: 'transparent',
              color: isDark ? '#E8EDF5' : '#0F172A', fontSize: 14, outline: 'none',
            }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: isDark ? '#5A6E87' : '#94A3B8', padding: 2 }}>
              <X size={14} />
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4, background: isDark ? '#0D1320' : '#F1F5F9', borderRadius: 10, padding: 3 }}>
          {['all', 'admin', 'client'].map(filter => (
            <button
              key={filter}
              onClick={() => setRoleFilter(filter)}
              style={{
                padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: roleFilter === filter ? (isDark ? '#2563EB' : '#2563EB') : 'transparent',
                color: roleFilter === filter ? '#FFFFFF' : (isDark ? '#5A6E87' : '#94A3B8'),
                fontSize: 13, fontWeight: 600, textTransform: 'capitalize',
                transition: 'all 0.2s',
              }}
            >
              {filter === 'all' ? `All (${users.length})` : filter === 'admin' ? `Admins (${adminCount})` : `Clients (${clientCount})`}
            </button>
          ))}
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div style={{
          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 10, padding: '14px 18px', marginBottom: 20, color: '#EF4444', fontSize: 14,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <AlertTriangle size={16} /> {error}
          <button onClick={fetchUsers} style={{ marginLeft: 'auto', background: '#EF4444', color: '#FFF', border: 'none', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            Retry
          </button>
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: isDark ? '#5A6E87' : '#94A3B8' }}>
          Loading users...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: isDark ? '#5A6E87' : '#94A3B8' }}>
          <Users size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
          <p style={{ margin: 0, fontSize: 15 }}>{search ? 'No users match your search' : 'No users yet'}</p>
        </div>
      ) : (
        /* User Table */
        <div style={cardStyle}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: isDark ? 'rgba(37,99,235,0.06)' : '#F8FAFC' }}>
                {['User', 'Company', 'Role', 'Projects', 'Joined', 'Actions'].map(h => (
                  <th key={h} style={{
                    padding: '12px 16px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.06em', color: isDark ? '#5A6E87' : '#94A3B8',
                    textAlign: h === 'Actions' ? 'right' : 'left', borderBottom: `1px solid ${isDark ? '#1C2A44' : '#E2E8F0'}`,
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((user, i) => (
                <tr
                  key={user.id}
                  style={{
                    borderBottom: i < filtered.length - 1 ? `1px solid ${isDark ? '#1C2A44' : '#F1F5F9'}` : 'none',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = isDark ? 'rgba(37,99,235,0.04)' : '#FAFBFE'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  {/* User Info */}
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{
                        width: 38, height: 38, borderRadius: '50%',
                        background: user.role === 'admin' ? 'linear-gradient(135deg, #2563EB, #7C3AED)' : (isDark ? '#1C2A44' : '#E2E8F0'),
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: user.role === 'admin' ? '#FFF' : (isDark ? '#5A6E87' : '#94A3B8'),
                        fontSize: 14, fontWeight: 700, flexShrink: 0,
                      }}>
                        {user.full_name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: isDark ? '#E8EDF5' : '#0F172A' }}>
                          {user.full_name}
                        </div>
                        <div style={{ fontSize: 12, color: isDark ? '#5A6E87' : '#94A3B8' }}>
                          {user.email}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Company */}
                  <td style={{ padding: '14px 16px', fontSize: 13, color: isDark ? '#94A3B8' : '#64748B' }}>
                    {user.company || '—'}
                  </td>

                  {/* Role Badge */}
                  <td style={{ padding: '14px 16px' }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                      background: user.role === 'admin' ? 'rgba(37,99,235,0.1)' : (isDark ? 'rgba(148,163,184,0.1)' : '#F1F5F9'),
                      color: user.role === 'admin' ? '#2563EB' : (isDark ? '#94A3B8' : '#64748B'),
                      border: `1px solid ${user.role === 'admin' ? 'rgba(37,99,235,0.2)' : 'transparent'}`,
                    }}>
                      {user.role === 'admin' && <Shield size={10} />}
                      {user.role}
                    </span>
                  </td>

                  {/* Projects Count */}
                  <td style={{ padding: '14px 16px' }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: 13, color: isDark ? '#94A3B8' : '#64748B',
                    }}>
                      <FolderOpen size={13} /> {user.project_count || 0}
                    </span>
                  </td>

                  {/* Joined Date */}
                  <td style={{ padding: '14px 16px', fontSize: 13, color: isDark ? '#5A6E87' : '#94A3B8' }}>
                    {user.created_at ? new Date(user.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                  </td>

                  {/* Actions */}
                  <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => handleToggleRole(user)}
                        title={user.role === 'admin' ? 'Demote to client' : 'Promote to admin'}
                        style={{
                          padding: '6px 8px', borderRadius: 6, border: `1px solid ${isDark ? '#1C2A44' : '#E2E8F0'}`,
                          background: 'transparent', cursor: 'pointer',
                          color: isDark ? '#94A3B8' : '#64748B', display: 'flex', alignItems: 'center',
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(37,99,235,0.1)'; e.currentTarget.style.color = '#2563EB'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = isDark ? '#94A3B8' : '#64748B'; }}
                      >
                        <Shield size={14} />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(user)}
                        title="Delete user"
                        style={{
                          padding: '6px 8px', borderRadius: 6, border: `1px solid ${isDark ? '#1C2A44' : '#E2E8F0'}`,
                          background: 'transparent', cursor: 'pointer',
                          color: isDark ? '#94A3B8' : '#64748B', display: 'flex', alignItems: 'center',
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; e.currentTarget.style.color = '#EF4444'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = isDark ? '#94A3B8' : '#64748B'; }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      <AddUserModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onUserAdded={(user) => setUsers(prev => [user, ...prev])}
        theme={t}
      />
      <DeleteConfirmModal
        isOpen={!!deleteTarget}
        user={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        theme={t}
      />
    </div>
  );
}
