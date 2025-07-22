import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://fmuherccixmmotybpxcm.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZtdWhlcmNjaXhtbW90eWJweGNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE0MzcxNDAsImV4cCI6MjA2NzAxMzE0MH0.M1jBxv9FafNK_2c8-T-PpDtxzkKvpC8i9-hk-2ws-Q4';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'implicit',
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    storageKey: 'sb-fmuherccixmmotybpxcm-auth-token',
    debug: false,
  },
  global: {
    headers: {
      'X-Client-Info': 'music-player-app'
    }
  },
  realtime: {
    params: {
      eventsPerSecond: 2
    }
  },
  db: {
    schema: 'public'
  }
})

// Add session recovery helper
export const recoverSession = async () => {
  try {
    const { data: { session }, error } = await supabase.auth.getSession()
    if (error) {
      console.error('Session recovery error:', error)
      // Try to refresh the session
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession()
      if (refreshError) {
        console.error('Session refresh error:', refreshError)
        return null
      }
      return refreshData.session
    }
    return session
  } catch (error) {
    console.error('Session recovery failed:', error)
    return null
  }
}

// Database types based on your schema
export interface DatabaseSong {
  file_id: number;
  img_id: number;
  name: string;
  artist: string;
  language: string;
  tags: string[];
  views: number;
  likes: number;
}

export interface DatabaseUser {
  id: string;
  email: string;
  username?: string;
  avatar_url?: string;
  created_at: string;
  last_login?: string;
  last_song_file_id?: number;
}

export interface DatabasePlaylist {
  id: number;
  user_id: string;
  name: string;
}

export interface DatabaseHistory {
  id: number;
  user_id: string;
  song_id: number;
  last_date: string;
  last_time: string;
  minutes_listened: number;
}
