import { supabase } from '@/lib/supabase'
import { User } from '@supabase/supabase-js'
import { useEffect, useState, useRef } from 'react'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [initialized, setInitialized] = useState(false)
  const initializationRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    // Prevent multiple initializations
    if (initializationRef.current) return
    initializationRef.current = true

    let mounted = true
    mountedRef.current = true

    console.log('🔄 Initializing auth...')

    const initializeAuth = async () => {
      try {
        // First, try to get the current session
        const { data: { session }, error } = await supabase.auth.getSession()
        
        if (!mounted || !mountedRef.current) return

        if (error) {
          console.error('❌ Session error:', error)
          // Try to refresh the session if there's an error
          try {
            const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession()
            if (!refreshError && refreshData.session && mounted) {
              console.log('✅ Session recovered via refresh')
              setUser(refreshData.session.user)
              setLoading(false)
              setInitialized(true)
              return
            }
          } catch (refreshErr) {
            console.error('❌ Failed to refresh session:', refreshErr)
          }
          
          if (mounted) {
            setUser(null)
            setLoading(false)
            setInitialized(true)
          }
          return
        }

        if (session?.user && mounted) {
          console.log('✅ Session found:', session.user.email)
          setUser(session.user)
          setLoading(false)
          setInitialized(true)
        } else if (mounted) {
          console.log('ℹ️ No session found')
          setUser(null)
          setLoading(false)
          setInitialized(true)
        }
      } catch (error) {
        console.error('❌ Auth initialization error:', error)
        if (mounted) {
          setUser(null)
          setLoading(false)
          setInitialized(true)
        }
      }
    }

    // Initialize auth immediately
    initializeAuth()

    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted || !mountedRef.current) return

        console.log('🔄 Auth state changed:', event, session?.user?.email || 'No user')
        
        switch (event) {
          case 'SIGNED_IN':
            if (session?.user) {
              setUser(session.user)
              setLoading(false)
              setInitialized(true)
              
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
                console.error('❌ Error updating user data:', error)
              }
            }
            break
            
          case 'SIGNED_OUT':
            setUser(null)
            setLoading(false)
            setInitialized(true)
            // Clear any cached data
            localStorage.removeItem('sb-fmuherccixmmotybpxcm-auth-token')
            break
            
          case 'TOKEN_REFRESHED':
            if (session?.user) {
              console.log('🔄 Token refreshed for:', session.user.email)
              setUser(session.user)
              setLoading(false)
              setInitialized(true)
            }
            break
            
          case 'USER_UPDATED':
            if (session?.user) {
              setUser(session.user)
            }
            break
            
          default:
            // For any other events, ensure we're initialized
            if (!initialized) {
              setLoading(false)
              setInitialized(true)
            }
        }
      }
    )

    return () => {
      mounted = false
      mountedRef.current = false
      subscription.unsubscribe()
    }
  }, []) // Empty dependency array to run only once

  const signInWithGoogle = async () => {
    try {
      setLoading(true)
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
        console.error('❌ Error signing in:', error)
        setLoading(false)
      }
    } catch (error) {
      console.error('❌ Sign in error:', error)
      setLoading(false)
    }
  }

  const signOut = async () => {
    try {
      setLoading(true)
      const { error } = await supabase.auth.signOut()
      if (error) {
        console.error('❌ Error signing out:', error)
      }
      // Clear any cached data
      localStorage.clear()
      sessionStorage.clear()
      setUser(null)
      setLoading(false)
      setInitialized(true)
    } catch (error) {
      console.error('❌ Sign out error:', error)
      setLoading(false)
    }
  }

  return {
    user,
    loading,
    initialized,
    signInWithGoogle,
    signOut
  }
}