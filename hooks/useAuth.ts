import { supabase } from '@/lib/supabase'
import { User } from '@supabase/supabase-js'
import { useEffect, useState, useRef } from 'react'

// Global state to prevent multiple auth initializations
let globalAuthState = {
  user: null as User | null,
  loading: true,
  initialized: false,
  isInitializing: false
}

let globalListeners: Array<(state: typeof globalAuthState) => void> = []
let authSubscription: any = null

// Global auth manager
const AuthManager = {
  subscribe: (callback: (state: typeof globalAuthState) => void) => {
    globalListeners.push(callback)
    // Immediately call with current state
    callback({ ...globalAuthState })
    
    return () => {
      globalListeners = globalListeners.filter(cb => cb !== callback)
    }
  },
  
  updateState: (updates: Partial<typeof globalAuthState>) => {
    globalAuthState = { ...globalAuthState, ...updates }
    globalListeners.forEach(callback => callback({ ...globalAuthState }))
  },
  
  initialize: async () => {
    if (globalAuthState.isInitializing || globalAuthState.initialized) {
      return
    }
    
    console.log('🔄 Initializing auth manager...')
    AuthManager.updateState({ isInitializing: true })
    
    try {
      // Get initial session
      const { data: { session }, error } = await supabase.auth.getSession()
      
      if (error) {
        console.error('❌ Session error:', error)
        // Try to refresh session
        const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession()
        if (!refreshError && refreshData.session) {
          AuthManager.updateState({
            user: refreshData.session.user,
            loading: false,
            initialized: true,
            isInitializing: false
          })
          console.log('✅ Session recovered via refresh:', refreshData.session.user.email)
          return
        }
      } else if (session?.user) {
        AuthManager.updateState({
          user: session.user,
          loading: false,
          initialized: true,
          isInitializing: false
        })
        console.log('✅ Session loaded:', session.user.email)
        return
      }
      
      // No session found
      AuthManager.updateState({
        user: null,
        loading: false,
        initialized: true,
        isInitializing: false
      })
      console.log('ℹ️ No session found')
      
    } catch (error) {
      console.error('❌ Auth initialization failed:', error)
      AuthManager.updateState({
        user: null,
        loading: false,
        initialized: true,
        isInitializing: false
      })
    }
  },
  
  setupAuthListener: () => {
    if (authSubscription) {
      return // Already set up
    }
    
    console.log('🔄 Setting up auth listener...')
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('🔄 Auth state changed:', event, session?.user?.email || 'No user')
        
        switch (event) {
          case 'SIGNED_IN':
            if (session?.user) {
              AuthManager.updateState({
                user: session.user,
                loading: false,
                initialized: true
              })
              
              // Update user data in database
              try {
                await supabase
                  .from('users')
                  .upsert({
                    id: session.user.id,
                    email: session.user.email!,
                    username: session.user.user_metadata?.full_name || session.user.user_metadata?.name,
                    avatar_url: session.user.user_metadata?.avatar_url,
                    last_login: new Date().toISOString()
                  })
              } catch (error) {
                console.error('Error updating user data:', error)
              }
            }
            break
            
          case 'SIGNED_OUT':
            AuthManager.updateState({
              user: null,
              loading: false,
              initialized: true
            })
            // Clear any cached data
            if (typeof window !== 'undefined') {
              localStorage.removeItem('sb-fmuherccixmmotybpxcm-auth-token')
            }
            break
            
          case 'TOKEN_REFRESHED':
            if (session?.user) {
              AuthManager.updateState({
                user: session.user,
                loading: false,
                initialized: true
              })
              console.log('🔄 Token refreshed for:', session.user.email)
            }
            break
            
          default:
            if (session?.user) {
              AuthManager.updateState({
                user: session.user,
                loading: false,
                initialized: true
              })
            } else if (!session) {
              // Try to recover session before giving up
              try {
                const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession()
                if (!refreshError && refreshData.session) {
                  AuthManager.updateState({
                    user: refreshData.session.user,
                    loading: false,
                    initialized: true
                  })
                  console.log('🔄 Session recovered during state change')
                  return
                }
              } catch (refreshErr) {
                console.error('Failed to recover session:', refreshErr)
              }
              
              AuthManager.updateState({
                user: null,
                loading: false,
                initialized: true
              })
            }
        }
      }
    )
    
    authSubscription = subscription
  }
}

export function useAuth() {
  const [authState, setAuthState] = useState(globalAuthState)
  const initRef = useRef(false)
  
  useEffect(() => {
    // Subscribe to global auth state
    const unsubscribe = AuthManager.subscribe(setAuthState)
    
    // Initialize auth manager only once
    if (!initRef.current) {
      initRef.current = true
      AuthManager.initialize()
      AuthManager.setupAuthListener()
    }
    
    return unsubscribe
  }, [])
  
  const signInWithGoogle = async () => {
    try {
      AuthManager.updateState({ loading: true })
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}`,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          }
        }
      })
      if (error) {
        console.error('Error signing in:', error)
        AuthManager.updateState({ loading: false })
      }
    } catch (error) {
      console.error('Sign in error:', error)
      AuthManager.updateState({ loading: false })
    }
  }

  const signOut = async () => {
    try {
      AuthManager.updateState({ loading: true })
      const { error } = await supabase.auth.signOut()
      if (error) {
        console.error('Error signing out:', error)
      }
      // Clear any cached data
      if (typeof window !== 'undefined') {
        localStorage.clear()
        sessionStorage.clear()
      }
      AuthManager.updateState({
        user: null,
        loading: false,
        initialized: true
      })
    } catch (error) {
      console.error('Sign out error:', error)
      AuthManager.updateState({ loading: false })
    }
  }

  return {
    user: authState.user,
    loading: authState.loading,
    initialized: authState.initialized,
    signInWithGoogle,
    signOut
  }
}
