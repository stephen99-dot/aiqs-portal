import React, { useState, useRef, useEffect } from 'react';
import { apiFetch } from '../utils/api';

export default function ChatPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function addFiles(fileList) {
    const newFiles = Array.from(fileList).slice(0, 5);
    setFiles(prev => [...prev, ...newFiles].slice(0, 5));
  }

  function removeFile(i) {
    setFiles(prev => prev.filter((_, idx) => idx !== i));
  }

  function fileIcon(name) {
    const ext = name.split('.').pop().toLowerCase();
    return { pdf: '📄', png: '🖼️', jpg: '🖼️', jpeg: '🖼️', dwg: '📐', dxf: '📐' }[ext] || '📎';
  }

  function formatSize(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
  }

  async function handleSend(e) {
    e.preventDefault();
    if (!input.trim() && files.length === 0) return;

    const userMessage = {
      role: 'user',
      content: input,
      files: files.map(f => ({ name: f.name, size: f.size })),
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    const currentInput = input;
    const currentFiles = [...files];
    setInput('');
    setFiles([]);
    setSending(true);

    try {
      // Build history (text only, no files in history)
      const history = messages
        .filter(m => m.content)
        .map(m => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : m.content
        }));

      const formData = new FormData();
      formData.append('message', currentInput);
      formData.append('history', JSON.stringify(history));
      currentFiles.forEach(f => formData.append('files', f));

      const data = await apiFetch('/chat', {
        method: 'POST',
        body: formData,
      });

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.reply,
        timestamp: new Date()
      }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, something went wrong. Please try again.',
        timestamp: new Date(),
        error: true
      }]);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  }

  function handleDragOver(e) { e.preventDefault(); }
  function handleDrop(e) {
    e.preventDefault();
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  }

  return (
    <div className="page chat-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">AI Quantity Surveyor</h1>
          <p className="page-subtitle">Upload drawings and chat about your project — get instant estimates and QS advice</p>
        </div>
      </div>

      <div className="chat-container" onDragOver={handleDragOver} onDrop={handleDrop}>
        <div className="chat-messages">
          {messages.length === 0 && (
            <div className="chat-welcome">
              <div className="chat-welcome-icon">📐</div>
              <h3>Ready to analyse your project</h3>
              <p>Upload your drawings (PDF or images) and ask me anything — rough costs, spec advice, quantities, building regs, risks to watch for.</p>
              <div className="chat-suggestions">
                <button onClick={() => setInput('Can you give me a rough cost estimate for this project?')} className="suggestion-btn">
                  💰 Rough cost estimate
                </button>
                <button onClick={() => setInput('What quantities can you extract from these drawings?')} className="suggestion-btn">
                  📊 Extract quantities
                </button>
                <button onClick={() => setInput('What are the key risks or issues you can see?')} className="suggestion-btn">
                  ⚠️ Identify risks
                </button>
                <button onClick={() => setInput('What building regulations should I consider?')} className="suggestion-btn">
                  📋 Building regs advice
                </button>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`chat-msg ${msg.role}`}>
              <div className="msg-avatar">
                {msg.role === 'user' ? '👤' : '📐'}
              </div>
              <div className="msg-content">
                {msg.role === 'user' && msg.files?.length > 0 && (
                  <div className="msg-files">
                    {msg.files.map((f, j) => (
                      <span key={j} className="msg-file-badge">
                        {fileIcon(f.name)} {f.name}
                      </span>
                    ))}
                  </div>
                )}
                <div className={`msg-text ${msg.error ? 'error' : ''}`}>
                  {msg.content.split('\n').map((line, j) => (
                    <React.Fragment key={j}>
                      {line}
                      {j < msg.content.split('\n').length - 1 && <br />}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
          ))}

          {sending && (
            <div className="chat-msg assistant">
              <div className="msg-avatar">📐</div>
              <div className="msg-content">
                <div className="msg-typing">
                  <span></span><span></span><span></span>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* File preview bar */}
        {files.length > 0 && (
          <div className="chat-files-bar">
            {files.map((f, i) => (
              <div key={i} className="chat-file-chip">
                <span>{fileIcon(f.name)}</span>
                <span className="chip-name">{f.name}</span>
                <span className="chip-size">{formatSize(f.size)}</span>
                <button onClick={() => removeFile(i)} className="chip-remove">×</button>
              </div>
            ))}
          </div>
        )}

        {/* Input bar */}
        <form onSubmit={handleSend} className="chat-input-bar">
          <button
            type="button"
            className="chat-attach-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Upload drawings"
          >
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
              <path d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
            style={{ display: 'none' }}
            accept=".pdf,.png,.jpg,.jpeg,.gif,.webp"
          />
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={files.length > 0 ? "Ask about these drawings..." : "Upload drawings or ask a QS question..."}
            rows={1}
            disabled={sending}
          />
          <button
            type="submit"
            className="chat-send-btn"
            disabled={sending || (!input.trim() && files.length === 0)}
          >
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
