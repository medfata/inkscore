"use client";

import React, { useState } from 'react';
import { X, Send, Loader2 } from './Icons';

interface PlatformRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PlatformRequestModal: React.FC<PlatformRequestModalProps> = ({ isOpen, onClose }) => {
  const [formData, setFormData] = useState({
    platform_name: '',
    platform_url: '',
    email: '',
    twitter_url: '',
    telegram_url: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/platform-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit request');
      }

      setSuccess(true);
      setFormData({ platform_name: '', platform_url: '', email: '', twitter_url: '', telegram_url: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setSuccess(false);
    setError('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={handleClose} />
      
      <div className="relative w-full max-w-md glass-card rounded-2xl p-6 animate-fade-in-up">
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors"
        >
          <X size={20} />
        </button>

        {success ? (
          <div className="text-center py-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
              <Send size={32} className="text-green-400" />
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">Request Submitted!</h3>
            <p className="text-slate-400 text-sm mb-6">
              We&apos;ll review your platform and get back to you soon.
            </p>
            <button
              onClick={handleClose}
              className="px-6 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <h2 className="text-2xl font-display font-bold mb-2">List Your Platform</h2>
            <p className="text-slate-400 text-sm mb-6">
              Submit your platform to be tracked by INKSCORE
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Platform Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                name="platform_name"
                value={formData.platform_name}
                onChange={handleChange}
                required
                placeholder="e.g., Velodrome"
                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-lg focus:outline-none focus:border-ink-purple transition-colors text-white placeholder-slate-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Platform URL <span className="text-red-400">*</span>
              </label>
              <input
                type="url"
                name="platform_url"
                value={formData.platform_url}
                onChange={handleChange}
                required
                placeholder="https://yourplatform.com"
                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-lg focus:outline-none focus:border-ink-purple transition-colors text-white placeholder-slate-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Email <span className="text-red-400">*</span>
              </label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                required
                placeholder="contact@yourplatform.com"
                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-lg focus:outline-none focus:border-ink-purple transition-colors text-white placeholder-slate-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Twitter URL
              </label>
              <input
                type="url"
                name="twitter_url"
                value={formData.twitter_url}
                onChange={handleChange}
                placeholder="https://twitter.com/yourplatform"
                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-lg focus:outline-none focus:border-ink-purple transition-colors text-white placeholder-slate-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Telegram URL
              </label>
              <input
                type="url"
                name="telegram_url"
                value={formData.telegram_url}
                onChange={handleChange}
                placeholder="https://t.me/yourplatform"
                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-lg focus:outline-none focus:border-ink-purple transition-colors text-white placeholder-slate-500"
              />
            </div>

            {error && (
              <p className="text-red-400 text-sm">{error}</p>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 bg-ink-purple hover:bg-purple-600 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Send size={20} />
                  Submit Request
                </>
              )}
            </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};
