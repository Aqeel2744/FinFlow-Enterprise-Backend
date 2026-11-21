import { Resend } from 'resend';
import { env } from './env.js';

export const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

if (resend) {
  console.log('Resend email service configured');
} else {
  console.warn('RESEND_API_KEY not provided. Email delivery simulated to logs.');
}
