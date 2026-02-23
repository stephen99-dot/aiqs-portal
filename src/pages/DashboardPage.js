import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';

const STATUS_MAP = {
  submitted: { label: 'Submitted', color: '#3B82F6', bg: 'rgba(59,130,246,0.1)' },
  in_review: { label: 'In Review', color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
  in_progress: { label: 'In Progress', color: '#A855F7', bg: 'rgba(168,85,247,0.1)' },
  completed: { label: 'Completed', color: '#10B981', bg: 'rgba(16,185,129,0.1)' },
  delivered: { label: 'Delivered', color: '#10B981', bg: 'rgba(16,185,129,0.15)' },
};

export default function DashboardPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/projects')
      .then(setProjects)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const firstName = user?.fullName?.split(' ')[0] || 'there';

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Welcome back, {firstName}</h1>
          <p className="page-subtitle">Here's an overview of your projects</p>
        </div>
        <Link to="/new-project" className="btn-primary">
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path d="M12 4v16m8-8H4"/></svg>
          New Project
        </Link>
      </div>

      {/* Stats row */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-value">{projects.length}</div>
          <div className="stat-label">Total Projects</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{projects.filter(p => p.status === 'submitted' || p.status === 'in_review').length}</div>
          <div className="stat-label">In Queue</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{projects.filter(p => p.status === 'in_progress').length}</div>
          <div className="stat-label">In Progress</div>
        </div>
        <div className="stat-card accent">
          <div className="stat-value">{projects.filter(p => p.status === 'completed' || p.status === 'delivered').length}</div>
          <div className="stat-label">Completed</div>
        </div>
      </div>

      {/* Projects list */}
      <div className="section-card">
        <div className="section-card-header">
          <h2>Your Projects</h2>
        </div>

        {loading ? (
          <div className="empty-state">
            <div className="loading-spinner" />
            <p>Loading your projects...</p>
          </div>
        ) : projects.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📐</div>
            <h3>No projects yet</h3>
            <p>Upload your first set of drawings and we'll get your BOQ started.</p>
            <Link to="/new-project" className="btn-primary" style={{ marginTop: 16 }}>
              Submit Your First Project
            </Link>
          </div>
        ) : (
          <div className="projects-list">
            {projects.map(project => {
              const status = STATUS_MAP[project.status] || STATUS_MAP.submitted;
              return (
                <Link to={`/project/${project.id}`} key={project.id} className="project-row">
                  <div className="project-info">
                    <div className="project-title">{project.title}</div>
                    <div className="project-meta">
                      <span className="project-type">{project.project_type}</span>
                      {project.location && <span className="project-location">· {project.location}</span>}
                      <span className="project-files">· {project.file_count || 0} file{(project.file_count || 0) !== 1 ? 's' : ''}</span>
                    </div>
                  </div>
                  <div className="project-right">
                    <span className="status-badge" style={{ color: status.color, background: status.bg }}>
                      {status.label}
                    </span>
                    <span className="project-date">
                      {new Date(project.created_at).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric'
                      })}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
