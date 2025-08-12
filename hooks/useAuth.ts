import { supabase } from '@/lib/supabase'
import { User } from '@supabase/supabase-js'
import { useEffect, useState, useCallback } from 'react'

interface LocalUserData {
  id: string
  email: string
  username?: string
  avatar_url?: string
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [localUserData, setLocalUserData] = useState<LocalUserData | null>(null)
  const [loading, setLoading] = useState(true)
  const [initialized, setInitialized] = useState(false)

  // Get user data from localStorage
  const getLocalUserData = useCallback((): LocalUserData | null => {
    try {
      const userData = localStorage.getItem('musicapp_user')
      if (userData) {
        const parsed = JSON.parse(userData)
        console.log('📱 Retrieved user data from localStorage:', parsed)
        return parsed
      }
      console.log('📱 No user data found in localStorage')
      return null
    } catch (error) {
      console.error('❌ Error parsing localStorage user data:', error)
      return null
    }
  }, [])

  // Save user data to localStorage
  const saveLocalUserData = useCallback((userData: LocalUserData) => {
    try {
      localStorage.setItem('musicapp_user', JSON.stringify(userData))
      console.log('💾 Saved user data to localStorage:', userData)
      setLocalUserData(userData)
    } catch (error) {
      console.error('❌ Error saving user data to localStorage:', error)
    }
  }, [])

  // Clear user data from localStorage
  const clearLocalUserData = useCallback(() => {
    try {
      localStorage.removeItem('musicapp_user')
      console.log('🗑️ Cleared user data from localStorage')
      setLocalUserData(null)
    } catch (error) {
      console.error('❌ Error clearing localStorage:', error)
    }
  }, [])

  // Initialize auth state
  useEffect(() => {
    if (initialized) return

    let mounted = true
    console.log('🔄 Initializing auth state...')

    const initializeAuth = async () => {
      try {
        // First, get localStorage data for immediate access
        const localData = getLocalUserData()
        if (localData && mounted) {
          setLocalUserData(localData)
          console.log('✅ Using localStorage user data for immediate access')
        }

        // Try to get session with shorter timeout for Vercel
        console.log('🔍 Checking for existing session...')
        
        const sessionPromise = supabase.auth.getSession()
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Session timeout')), 5000) // Reduced timeout for Vercel
        )

        try {
          const { data: { session }, error } = await Promise.race([
            sessionPromise,
            timeoutPromise
          ]) as any

          if (mounted) {
            if (error) {
              console.warn('⚠️ Session error:', error.message)
              // If we have local data, use it; otherwise show login
              if (localData) {
                console.log('✅ Using localStorage data due to session error')
                setUser(null)
                setLoading(false)
              } else {
                console.log('❌ No session and no localStorage data')
                setUser(null)
                setLocalUserData(null)
                setLoading(false)
              }
            } else if (session?.user) {
              console.log('✅ Valid session found for user:', session.user.email)
              setUser(session.user)
              
              // Update localStorage with fresh session data
              const userData: LocalUserData = {
                id: session.user.id,
                email: session.user.email!,
                username: session.user.user_metadata?.full_name || session.user.user_metadata?.name,
                avatar_url: session.user.user_metadata?.avatar_url
              }
              saveLocalUserData(userData)
              setLoading(false)
            } else {
              console.log('❌ No valid session found')
              if (!localData) {
                setUser(null)
                setLocalUserData(null)
              }
              setLoading(false)
            }
          }
        } catch (sessionError) {
          console.warn('⚠️ Session check failed:', sessionError)
          if (mounted) {
            // If session check fails but we have local data, use it
            if (localData) {
              console.log('✅ Using localStorage data due to session failure')
              setUser(null)
              setLoading(false)
            } else {
              console.log('❌ Session check failed and no localStorage data')
              setUser(null)
              setLocalUserData(null)
              setLoading(false)
            }
          }
        }

        setInitialized(true)
      } catch (error) {
        console.error('❌ Failed to initialize auth:', error)
        if (mounted) {
          setLoading(false)
          setInitialized(true)
        }
      }
    }

    initializeAuth()

    return () => {
      mounted = false
    }
  }, [initialized, getLocalUserData, saveLocalUserData])

  // Listen for auth changes (only after initialization)
  useEffect(() => {
    if (!initialized) return

    console.log('🔄 Setting up auth state listener...')
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('🔄 Auth state changed:', event, session?.user?.email)
        
        if (event === 'SIGNED_OUT' || !session) {
          console.log('👋 User signed out')
          setUser(null)
          clearLocalUserData()
          return
        }

        if (event === 'SIGNED_IN' && session?.user) {
          console.log('👋 User signed in:', session.user.email)
          setUser(session.user)

          // Save user data to localStorage
          const userData: LocalUserData = {
            id: session.user.id,
            email: session.user.email!,
            username: session.user.user_metadata?.full_name || session.user.user_metadata?.name,
            avatar_url: session.user.user_metadata?.avatar_url
          }
          saveLocalUserData(userData)

          // Update last_login when user signs in
          try {
            console.log('📝 Updating user data in database...')
            await supabase
              .from('users')
              .upsert({
                id: session.user.id,
                email: session.user.email!,
                username: userData.username,
                avatar_url: userData.avatar_url,
                last_login: new Date().toISOString()
              })
            console.log('✅ User data updated in database')
          } catch (error) {
            console.error('❌ Error updating user data:', error)
          }
        }
      }
    )

    return () => {
      subscription.unsubscribe()
      console.log('🔄 Auth listener cleanup completed')
    }
  }, [initialized, saveLocalUserData, clearLocalUserData])

  const signInWithGoogle = async () => {
    try {
      console.log('🔐 Starting Google sign in...')
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
      } else {
        console.log('✅ Google sign in initiated')
      }
    } catch (error) {
      console.error('❌ Sign in error:', error)
      setLoading(false)
    }
  }

  const signOut = async () => {
    try {
      console.log('👋 Starting sign out...')
      setLoading(true)
      const { error } = await supabase.auth.signOut()
      if (error) {
        console.error('❌ Error signing out:', error)
      } else {
        console.log('✅ Successfully signed out')
      }
      // Clear all cached data
      localStorage.clear()
      sessionStorage.clear()
      clearLocalUserData()
      setUser(null)
      setLoading(false)
    } catch (error) {
      console.error('❌ Sign out error:', error)
      setLoading(false)
    }
  }

  // Return both session user and local user data
  // Priority: use session user if available, otherwise use local data
  const effectiveUser = user || (localUserData
    ? ({
        id: localUserData.id,
        email: localUserData.email,
        user_metadata: {
          full_name: localUserData.username,
          name: localUserData.username,
          avatar_url: localUserData.avatar_url
        }
      } as unknown as User)
    : null)

  return {
    user: effectiveUser,
    localUserData,
    loading,
    signInWithGoogle,
    signOut,
    getUserId: () => localUserData?.id || user?.id || null,
    isAuthenticated: !!(localUserData || user)
  }
}