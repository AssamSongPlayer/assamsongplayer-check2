import { supabase } from '@/lib/supabase'
import { User } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    // Get initial session with timeout
    const getInitialSession = async () => {
      try {
        // Set a timeout for the session check
        const sessionPromise = supabase.auth.getSession()
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Session timeout')), 5000)
        )

        const { data: { session }, error } = await Promise.race([
          sessionPromise,
          timeoutPromise
        ]) as any

        if (error) {
          console.error('Session error:', error)
          if (mounted) {
            setUser(null)
            setLoading(false)
          }
          return
        }

        if (mounted) {
          setUser(session?.user ?? null)
          setLoading(false)
        }
      } catch (error) {
        console.error('Failed to get session:', error)
        if (mounted) {
          setUser(null)
          setLoading(false)
        }
      }
    }

    getInitialSession()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('Auth state changed:', event, session?.user?.email)
        
        if (!mounted) return

        if (event === 'SIGNED_OUT' || !session) {
          setUser(null)
          setLoading(false)
          return
        }

        if (event === 'SIGNED_IN' && session?.user) {
          setUser(session.user)
          setLoading(false)

          // Update last_login when user signs in
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
        } else {
          setUser(session?.user ?? null)
          setLoading(false)
        }
      }
    )

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

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
        console.error('Error signing in:', error)
        setLoading(false)
      }
    } catch (error) {
      console.error('Sign in error:', error)
      setLoading(false)
    }
  }

  const signOut = async () => {
    try {
      setLoading(true)
      const { error } = await supabase.auth.signOut()
      if (error) {
        console.error('Error signing out:', error)
      }
      // Clear any cached data
      localStorage.clear()
      sessionStorage.clear()
      setUser(null)
      setLoading(false)
    } catch (error) {
      console.error('Sign out error:', error)
      setLoading(false)
    }
  }

  return {
    user,
    loading,
    signInWithGoogle,
    signOut
  }
}
