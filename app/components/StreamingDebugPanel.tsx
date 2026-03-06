"use client";

import React, { useState } from 'react';
import { Activity, CheckCircle, XCircle, Clock, Wifi, WifiOff } from './Icons';

interface StreamingDebugPanelProps {
  isConnected: boolean;
  isComplete: boolean;
  loadingMetrics: Set<string>;
  errors: Record<string, string>;
  totalDuration: number | null;
  timedOut: boolean;
  totalMetrics: number;
}

export const StreamingDebugPanel: React.FC<StreamingDebugPanelProps> = ({
  isConnected,
  isComplete,
  loadingMetrics,
  errors,
  totalDuration,
  timedOut,
  totalMetrics,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const loadedCount = totalMetrics - loadingMetrics.size;
  const errorCount = Object.keys(errors).length;

  return (
    <>
      {/* Toggle Button - Fixed position in bottom right */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-4 right-4 z-50 p-3 rounded-full bg-slate-800 border border-slate-700 hover:border-ink-purple/50 transition-all shadow-lg hover:shadow-ink-purple/20"
        title="Toggle Debug Panel"
      >
        <Activity size={20} className="text-slate-300" />
      </button>

      {/* Debug Panel */}
      {isOpen && (
        <div className="fixed bottom-20 right-4 z-50 w-80 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="bg-slate-800 px-4 py-3 border-b border-slate-700 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity size={16} className="text-ink-purple" />
              <h3 className="text-sm font-semibold text-white">Streaming Debug</h3>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-white transition-colors"
            >
              ×
            </button>
          </div>

          {/* Content */}
          <div className="p-4 space-y-4 max-h-96 overflow-y-auto">
            {/* Connection Status */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Connection</span>
              <div className="flex items-center gap-2">
                {isConnected ? (
                  <>
                    <Wifi size={14} className="text-green-400" />
                    <span className="text-sm font-medium text-green-400">Connected</span>
                  </>
                ) : (
                  <>
                    <WifiOff size={14} className="text-slate-500" />
                    <span className="text-sm font-medium text-slate-500">Disconnected</span>
                  </>
                )}
              </div>
            </div>

            {/* Progress Stats */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">Loading</span>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse"></div>
                  <span className="text-sm font-mono font-medium text-yellow-400">
                    {loadingMetrics.size}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">Loaded</span>
                <div className="flex items-center gap-2">
                  <CheckCircle size={14} className="text-green-400" />
                  <span className="text-sm font-mono font-medium text-green-400">
                    {loadedCount}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">Errors</span>
                <div className="flex items-center gap-2">
                  <XCircle size={14} className={errorCount > 0 ? "text-red-400" : "text-slate-600"} />
                  <span className={`text-sm font-mono font-medium ${errorCount > 0 ? "text-red-400" : "text-slate-600"}`}>
                    {errorCount}
                  </span>
                </div>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Progress</span>
                <span className="text-slate-400 font-mono">
                  {Math.round((loadedCount / totalMetrics) * 100)}%
                </span>
              </div>
              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-ink-blue to-ink-purple transition-all duration-300"
                  style={{ width: `${(loadedCount / totalMetrics) * 100}%` }}
                ></div>
              </div>
            </div>

            {/* Duration */}
            {isComplete && totalDuration !== null && (
              <div className="flex items-center justify-between pt-2 border-t border-slate-700">
                <span className="text-sm text-slate-400 flex items-center gap-2">
                  <Clock size={14} />
                  Total Duration
                </span>
                <span className="text-sm font-mono font-medium text-white">
                  {(totalDuration / 1000).toFixed(2)}s
                </span>
              </div>
            )}

            {/* Timeout Warning */}
            {timedOut && (
              <div className="p-2 bg-yellow-500/10 border border-yellow-500/20 rounded text-xs text-yellow-400">
                ⚠️ Stream timed out after 30s
              </div>
            )}

            {/* Error List */}
            {errorCount > 0 && (
              <div className="space-y-1 pt-2 border-t border-slate-700">
                <span className="text-xs text-slate-500 uppercase tracking-wider">Failed Metrics</span>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {Object.entries(errors).map(([metricId, error]) => (
                    <div key={metricId} className="text-xs p-2 bg-red-500/10 border border-red-500/20 rounded">
                      <div className="font-mono text-red-400">{metricId}</div>
                      <div className="text-slate-400 truncate">{error}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Completion Status */}
            {isComplete && (
              <div className="p-2 bg-green-500/10 border border-green-500/20 rounded text-xs text-green-400 text-center">
                ✓ All metrics completed
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
