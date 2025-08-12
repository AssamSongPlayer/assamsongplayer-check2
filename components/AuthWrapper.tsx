import { useAuth } from '@/hooks/useAuth'
import React, { useEffect } from 'react'
import LoginPage from './LoginPage'

interface AuthWrapperProps {
  children: React.ReactNode
}

const AuthWrapper: React.FC<AuthWrapperProps> = ({ children }) => {
  const { user, localUserData, loading, isAuthenticated } = useAuth()

  // Enhanced loading check with localStorage fallback
  useEffect(() => {
    console.log('🔍 AuthWrapper state check:')
    console.log('  - Loading:', loading)
    console.log('  - Session user:', user?.email || 'none')
    console.log('  - Local user data:', localUserData?.email || 'none')
    console.log('  - Is authenticated:', isAuthenticated)
  }, [loading, user, localUserData, isAuthenticated])

  // Show loading spinner with better timeout handling
  if (loading) {
    console.log('⏳ Showing loading spinner')
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
          </div>
          <p className="text-white text-lg">Loading your music...</p>
          <p className="text-gray-400 text-sm mt-2">Checking authentication...</p>
        </div>
      </div>
    )
  }

  // Show login page if no authentication (neither session nor localStorage)
  if (!isAuthenticated) {
    console.log('🚫 No authentication found, showing login page')
    return <LoginPage />
  }

  // Show main app if user is authenticated (either session or localStorage)
  console.log('✅ User authenticated, showing main app')
  return <>{children}</>
}

export default AuthWrapper