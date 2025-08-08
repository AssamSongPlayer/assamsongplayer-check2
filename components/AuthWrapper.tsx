import { useAuth } from '@/hooks/useAuth'
import React, { useEffect } from 'react'
import LoginPage from './LoginPage'

interface AuthWrapperProps {
  children: React.ReactNode
}

const AuthWrapper: React.FC<AuthWrapperProps> = ({ children }) => {
  const { user, loading } = useAuth()

  // Force re-authentication on page reload if no valid session
useEffect(() => {
  const checkAuthOnReload = () => {
    // Cast the navigation entry to the correct type
    const navEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;

    const isReload =
      performance.navigation?.type === 1 || navEntry?.type === 'reload';

    if (isReload && !user && !loading) {
      console.log('Page reloaded without valid session, redirecting to login');
      localStorage.clear();
      sessionStorage.clear();
    }
  };

  const timer = setTimeout(checkAuthOnReload, 1000);
  return () => clearTimeout(timer);
}, [user, loading]);

  // Show loading spinner with timeout
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
          </div>
          <p className="text-white text-lg">Loading your music...</p>
          <p className="text-gray-400 text-sm mt-2">This should only take a moment</p>
        </div>
      </div>
    )
  }

  // Show login page if no user
  if (!user) {
    return <LoginPage />
  }

  // Show main app if user is authenticated
  return <>{children}</>
}

export default AuthWrapper
