import React from 'react';

interface VerificationBadgeProps {
  email?: string;
  verified?: boolean;
}

export function VerificationBadge({ email }: VerificationBadgeProps) {
  if (email === 'nnanwubagabriel@gmail.com') {
    return (
      <span 
        className="inline-flex items-center justify-center bg-green-500 text-white rounded-full p-0.5 shrink-0 align-middle select-none animate-fade-in shadow-xs" 
        style={{ width: '15.5px', height: '15.5px' }} 
        title="Admin Verified Badge"
      >
        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </span>
    );
  }
  return null;
}
