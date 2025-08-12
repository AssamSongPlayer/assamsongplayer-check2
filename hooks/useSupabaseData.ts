import { DatabaseSong, supabase } from '@/lib/supabase';
import { Playlist, Song } from '@/types';
import { User } from '@supabase/supabase-js';
import { useEffect, useRef, useState } from 'react';

export function useSupabaseData(user: User | null) {
  // Caches for songs and liked songs to avoid repeated cloud fetches
  const songsCache = useRef<any[] | null>(null);
  const likedSongsCache = useRef<Set<number> | null>(null);
  const [songs, setSongs] = useState<Song[]>([])
  // Personalized songs state (smart sorted, filtered, and history-excluded)
  const [personalizedSongs, setPersonalizedSongs] = useState<Song[]>([])
  // Trending songs state (top 15 by views+likes)
  const [trendingSongs, setTrendingSongs] = useState<Song[]>([])
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [likedSongs, setLikedSongs] = useState<Set<number>>(new Set())
  const [lastPlayedSong, setLastPlayedSong] = useState<Song | null>(null)
  const [recentlyPlayedSongs, setRecentlyPlayedSongs] = useState<Song[]>([])
  const [loading, setLoading] = useState(true)
  const [dataLoaded, setDataLoaded] = useState(false)
  const [currentSongStartTime, setCurrentSongStartTime] = useState<Date | null>(null)
  const currentSongRef = useRef<string | null>(null)

  // Get user ID from localStorage or session
  const getUserId = (): string | null => {
    try {
      // First try to get from session user
      if (user?.id) {
        console.log('🆔 Using session user ID:', user.id)
        return user.id
      }
      
      // Fallback to localStorage
      const userData = localStorage.getItem('musicapp_user')
      if (userData) {
        const parsed = JSON.parse(userData)
        console.log('🆔 Using localStorage user ID:', parsed.id)
        return parsed.id
      }
      
      console.log('❌ No user ID available')
      return null
    } catch (error) {
      console.error('❌ Error getting user ID:', error)
      return null
    }
  }

  // Get personalized songs based on user's actual listening preferences
  const getSmartPersonalizedSongs = async (
    userId: string,
    listenedSongsInBatch: Song[], 
    excludeSongs: Set<string>
  ): Promise<Song[]> => {
    try {
      console.log('🧠 Fetching smart personalized songs based on listening behavior');
      console.log('🎵 Songs user actually listened to:', listenedSongsInBatch.map(s => s.name));
      
      if (listenedSongsInBatch.length === 0) {
        console.log('⚠️ No listened songs in batch, falling back to regular personalization');
        return [];
      }

      // Extract tags and artists from listened songs
      const preferredTags = new Set<string>();
      const preferredArtists = new Set<string>();
      
      listenedSongsInBatch.forEach(song => {
        song.tags?.forEach(tag => preferredTags.add(tag.toLowerCase()));
        preferredArtists.add(song.artist.toLowerCase());
      });

      console.log('🏷️ Preferred tags:', Array.from(preferredTags));
      console.log('🎤 Preferred artists:', Array.from(preferredArtists));

      // Use cache if available, otherwise fetch and cache
      let songsData = songsCache.current;
      if (!songsData) {
        console.log('📥 Fetching songs from database for smart recommendations...')
        const { data, error } = await supabase
          .from('songs')
          .select('*');
        if (error) {
          console.error('❌ Error fetching songs for smart personalization:', error);
          return [];
        }
        if (!data || data.length === 0) {
          console.warn('⚠️ No songs found in database');
          return [];
        }
        songsData = data;
        songsCache.current = data;
        console.log('✅ Songs cached for smart recommendations:', data.length)
      }

      let userLikedSongs = likedSongsCache.current;
      if (!userLikedSongs) {
        console.log('📥 Fetching liked songs for smart recommendations...')
        const { data: likedData } = await supabase
          .from('liked_songs')
          .select('song_id')
          .eq('user_id', userId);
        userLikedSongs = new Set<number>();
        if (likedData) {
          likedData.forEach(item => userLikedSongs!.add(item.song_id));
        }
        likedSongsCache.current = userLikedSongs;
        console.log('✅ Liked songs cached:', userLikedSongs.size)
      }

      // Filter and score songs based on listening preferences and language
      // Use the language of the first listened song as the filter
      const languageFilter = listenedSongsInBatch[0]?.language;
      const availableSongs = songsData.filter((song) => {
        return (
          !excludeSongs.has(song.file_id.toString()) &&
          song.language === languageFilter
        );
      });

      console.log(`🎵 Available songs for smart recommendations (language: ${languageFilter}): ${availableSongs.length}`);

      if (availableSongs.length === 0) {
        console.warn('⚠️ No available songs after filtering');
        return [];
      }

      // Score songs based on user's listening preferences
      const scoredSongs = availableSongs.map((song) => {
        let score = 0;

        // High priority: Tag matching with listened songs
        const songTags = song.tags?.map((tag: string) => tag.toLowerCase()) || [];
        const matchingTags = songTags.filter((tag: string) => preferredTags.has(tag));
        score += matchingTags.length * 25; // Higher weight for tag matching

        // High priority: Artist matching with listened songs
        if (preferredArtists.has(song.artist.toLowerCase())) {
          score += 30; // Higher weight for artist matching
        }

        // Medium priority: Same language as listened songs
        const listenedLanguages = listenedSongsInBatch.map(s => s.language);
        if (listenedLanguages.includes(song.language)) {
          score += 15;
        }

        // Lower priority: General popularity
        score += Math.log(1 + (song.likes || 0)) * 2;
        score += Math.log(1 + (song.views || 0)) * 1;

        // Bonus for liked songs
        if (userLikedSongs.has(song.file_id)) {
          score += 10;
        }

        // Add small randomness to avoid repetition
        score += Math.random() * 2;

        return {
          song: convertDatabaseSong(song, userLikedSongs.has(song.file_id)), 
          score
        };
      });

      // Sort by score and return top recommendations
      const recommendations = scoredSongs
        .sort((a, b) => b.score - a.score)
        .slice(0, 15) // Get more songs for variety
        .map(entry => entry.song);

      console.log('🧠 Smart recommendations based on listening behavior:', 
        recommendations.slice(0, 5).map(s => `${s.name} by ${s.artist}`));
      
      return recommendations;
      
    } catch (error) {
      console.error('❌ Error in getSmartPersonalizedSongs:', error);
      return [];
    }
  };

  // Convert database song to UI song format
  const convertDatabaseSong = (dbSong: DatabaseSong, isLiked: boolean = false): Song => ({
    file_id: dbSong.file_id,
    img_id: dbSong.img_id,
    name: dbSong.name,
    artist: dbSong.artist,
    language: dbSong.language,
    tags: dbSong.tags,
    views: dbSong.views,
    likes: dbSong.likes,
    id: dbSong.file_id.toString(),
    image: `https://images.pexels.com/photos/${dbSong.img_id}/pexels-photo-${dbSong.img_id}.jpeg?auto=compress&cs=tinysrgb&w=300`,
    isLiked
  })

  // Fetch all songs with better error handling
  const fetchSongs = async (userId: string) => {
    try {
      console.log('📥 Fetching all songs from supabase for user:', userId);
      
      // Fetch songs with timeout for Vercel
      const songsPromise = supabase
        .from('songs')
        .select('*')
        .order('views', { ascending: false });
      
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Songs fetch timeout')), 10000)
      );

      const { data: songsData, error } = await Promise.race([
        songsPromise,
        timeoutPromise
      ]) as any;

      if (error) {
        console.error('❌ Error fetching songs:', error)
        throw error
      }
      console.log('✅ Fetched songs:', songsData?.length);

      // Fetch liked songs with timeout
      console.log('📥 Fetching liked songs for user:', userId)
      let userLikedSongs = new Set<number>()
      
      const likedPromise = supabase
        .from('liked_songs')
        .select('song_id')
        .eq('user_id', userId);
      
      const likedTimeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Liked songs fetch timeout')), 8000)
      );

      try {
        const { data: likedData, error: likedError } = await Promise.race([
          likedPromise,
          likedTimeoutPromise
        ]) as any;
        
        if (likedError) {
          console.error('❌ Error fetching liked songs:', likedError)
        } else if (likedData) {
          userLikedSongs = new Set(
  likedData.map((item: { song_id: string }) => item.song_id)
);
          setLikedSongs(userLikedSongs)
          console.log('✅ Fetched liked songs:', userLikedSongs.size)
        }
      } catch (likedTimeout) {
        console.warn('⚠️ Liked songs fetch timeout, continuing without liked songs')
      }

      // Fetch user history with timeout
      console.log('📥 Fetching user history for user:', userId)
      let historyData: any[] = [];
      
      try {
        const historyPromise = supabase
          .from('history')
          .select('song_id, minutes_listened, songs(*)')
          .eq('user_id', userId)
          .order('minutes_listened', { ascending: false });
        
        const historyTimeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('History fetch timeout')), 8000)
        );

        const { data, error: historyError } = await Promise.race([
          historyPromise,
          historyTimeoutPromise
        ]) as any;
        
        if (historyError) {
          console.error('❌ Error fetching history:', historyError)
        } else {
          historyData = data || [];
          console.log('✅ Fetched user history:', historyData.length);
        }
      } catch (historyTimeout) {
        console.warn('⚠️ History fetch timeout, continuing without history')
      }

      // Get top 15 most listened songs from history
      const topHistory = historyData.slice(0, 15).filter(h => h.songs)
      // Collect tags and artists from top 15
      const tagCount: Record<string, number> = {}
      const artistCount: Record<string, number> = {}
      topHistory.forEach(h => {
        // h.songs may be an array or object, use first if array
        const songObj = Array.isArray(h.songs) ? h.songs[0] : h.songs;
        (songObj?.tags || []).forEach((tag: string) => {
          const t = tag.toLowerCase();
          tagCount[t] = (tagCount[t] || 0) + 1;
        });
        if (songObj?.artist) {
          const a = songObj.artist.toLowerCase();
          artistCount[a] = (artistCount[a] || 0) + 1;
        }
      });
      // Find most common tags and artists
      const commonTags = Object.entries(tagCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([tag]) => tag);
      const commonArtists = Object.entries(artistCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([artist]) => artist);
      console.log('🏷️ Found similar tags:', commonTags);
      console.log('🎤 Found similar artists:', commonArtists);

      // Songs in history (to exclude for smart sort)
      const historySongIds = new Set(historyData.map(h => h.song_id?.toString()));

      // Convert all songs
     const convertedSongs = songsData?.map((song: DatabaseSong) =>
  convertDatabaseSong(song, userLikedSongs.has(song.file_id))
) || [];


      setSongs(convertedSongs); // songs is now all songs, not personalized
      console.log('✅ Set all songs:', convertedSongs.length)

      // Filter out songs in history for personalized sort
    const filteredSongs = convertedSongs.filter((song: Song) => !historySongIds.has(song.id));


      // Score songs by tag/artist match
      const scoredSongs = filteredSongs.map(song => {
        let score = 0;
        // Tag match
        const songTags = (song.tags || []).map((t: string) => t.toLowerCase());
        score += songTags.filter(t => commonTags.includes(t)).length * 10;
        // Artist match
        if (song.artist && commonArtists.includes(song.artist.toLowerCase())) {
          score += 20;
        }
        // Popularity
        score += (song.views || 0) + (song.likes || 0);
        return { song, score };
      });
      // Sort by score descending
      const personalizedSorted = scoredSongs.sort((a, b) => b.score - a.score).map(s => s.song);

      setPersonalizedSongs(personalizedSorted);
      console.log('✅ Set personalized songs:', personalizedSorted.length)

      // Trending: top 15 by views+likes (from all songs, including history)
      const trending = [...convertedSongs]
        .sort((a, b) => (b.views + b.likes) - (a.views + a.likes))
        .slice(0, 15);
      setTrendingSongs(trending);
      console.log('✅ Set trending songs:', trending.length);
      console.log('🔥 Trending songs:', trending.slice(0, 5).map(s => `${s.name} (${s.views} views, ${s.likes} likes)`));

      // Set last played song
      console.log('📥 Fetching last played song for user:', userId)
      try {
        const userPromise = supabase
          .from('users')
          .select('last_song_file_id')
          .eq('id', userId)
          .single();
        
        const userTimeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('User data fetch timeout')), 5000)
        );

        const { data: userData, error: userError } = await Promise.race([
          userPromise,
          userTimeoutPromise
        ]) as any;
        
        if (userError) {
          console.error('❌ Error fetching user data:', userError)
        } else if (userData?.last_song_file_id) {
          const lastSong = convertedSongs.find(song => song.file_id === userData.last_song_file_id)
          if (lastSong) {
            setLastPlayedSong(lastSong)
            console.log('✅ Set last played song:', lastSong.name)
          }
        }
      } catch (userTimeout) {
        console.warn('⚠️ User data fetch timeout, continuing without last played song')
      }

      return true;
    } catch (error) {
      console.error('❌ Error fetching songs:', error)
      setSongs([])
      setPersonalizedSongs([])
      setTrendingSongs([])
      return false;
    }
  }

  // Get personalized songs with proper error handling and filtering
  const getPersonalizedSongs = async (userId: string, currentSong: Song, listenedSongs?: Set<string>): Promise<Song[]> => {
    try {
      console.log('🎵 Fetching personalized songs for:', currentSong.name);
      console.log('🎵 Listened songs count:', listenedSongs?.size || 0);
      
      // 1. Fetch all songs from cache or cloud
      let songsData = songsCache.current;
      if (!songsData) {
        console.log('📥 Cache miss, fetching songs from database...')
        const { data, error } = await supabase
          .from('songs')
          .select('*');
        if (error) {
          console.error('❌ Error fetching songs for personalization:', error);
          return [];
        }
        if (!data || data.length === 0) {
          console.warn('⚠️ No songs found in database');
          return [];
        }
        songsData = data;
        songsCache.current = data;
        console.log('✅ Songs cached:', data.length)
      }

      // 2. Fetch user's listening history (not cached, as it may change frequently)
      console.log('📥 Fetching listening history for personalization...')
      const { data: historyData, error: historyError } = await supabase
        .from('history')
        .select('song_id, minutes_listened')
        .eq('user_id', userId);
      if (historyError) {
        console.error('❌ Error fetching history:', historyError);
      }
      const historyMap = new Map<number, number>();
      if (historyData) {
        historyData.forEach(h => historyMap.set(h.song_id, h.minutes_listened || 0));
        console.log('✅ History loaded:', historyData.length, 'entries')
      }

      // 3. Get user's liked songs from cache or cloud
      let userLikedSongs = likedSongsCache.current;
      if (!userLikedSongs) {
        console.log('📥 Cache miss, fetching liked songs...')
        const { data: likedData } = await supabase
          .from('liked_songs')
          .select('song_id')
          .eq('user_id', userId);
        userLikedSongs = new Set<number>();
        if (likedData) {
          likedData.forEach(item => userLikedSongs!.add(item.song_id));
        }
        likedSongsCache.current = userLikedSongs;
        console.log('✅ Liked songs cached:', userLikedSongs.size)
      }

      // 4. Filter and score songs (add language filter)
      const languageFilter = currentSong.language;
      const availableSongs = songsData.filter((song) => {
        // Exclude current song
        if (song.file_id === currentSong.file_id) {
          return false;
        }
        // Exclude listened songs if provided
        if (listenedSongs && listenedSongs.has(song.file_id.toString())) {
          console.log(`🚫 Excluding listened song: ${song.name} by ${song.artist}`);
          return false;
        }
        // Only include songs with the same language as current song
        if (song.language !== languageFilter) {
          return false;
        }
        return true;
      });

      console.log(`🎵 Available songs after filtering (language: ${languageFilter}): ${availableSongs.length}`);

      if (availableSongs.length === 0) {
        console.warn('⚠️ No available songs after filtering');
        return [];
      }

      // 5. Score and sort songs
      const scoredSongs = availableSongs.map((song) => {
        let score = 0;

        // Tag matching (highest priority)
        const matchingTags = song.tags?.filter((tag: string) =>
          currentSong.tags?.includes(tag)
        ) || [];
        score += matchingTags.length * 15;

        // Artist matching
        if (song.artist === currentSong.artist) {
          score += 25;
        }

        // Language matching
        if (song.language === currentSong.language) {
          score += 10;
        }

        // Listening history boost
        const listenedMinutes = historyMap.get(song.file_id) || 0;
        score += Math.min(listenedMinutes * 2, 20); // Cap at 20 points

        // Popularity boost (likes and views)
        score += Math.log(1 + (song.likes || 0)) * 2;
        score += Math.log(1 + (song.views || 0)) * 1;

        // Liked songs boost
        if (userLikedSongs.has(song.file_id)) {
          score += 8;
        }

        // Add controlled randomness to avoid repetition
        score += Math.random() * 3;

        return {
          song: convertDatabaseSong(song, userLikedSongs.has(song.file_id)),
          score
        };
      });

      // 6. Sort by score and return top recommendations
      const recommendations = scoredSongs
        .sort((a, b) => b.score - a.score)
        .slice(0, 10) // Get more songs to have a buffer
        .map(entry => entry.song);

      console.log('🎵 Personalized recommendations:', recommendations.slice(0, 5).map(s => `${s.name} by ${s.artist}`));
      console.log('🎵 Total available songs:', availableSongs.length);
      
      return recommendations;
      
    } catch (error) {
      console.error('❌ Error in getPersonalizedSongs:', error);
      return [];
    }
  };

  // Fetch recently played songs based on listening history
  const fetchRecentlyPlayed = async (userId: string) => {
    try {
      console.log('📥 Fetching recently played songs for user:', userId)
      // Get user's listening history sorted by minutes listened
      const { data: historyData, error: historyError } = await supabase
        .from('history')
        .select(`
          song_id,
          minutes_listened,
          songs (*)
        `)
        .eq('user_id', userId)
        .order('minutes_listened', { ascending: false })
        .limit(9)

      if (historyError) {
        console.error('❌ Error fetching recently played:', historyError)
        return
      }

      if (!historyData || historyData.length === 0) {
        console.log('📭 No recently played songs found')
        setRecentlyPlayedSongs([])
        return
      }

      // Get user's liked songs for proper conversion
      console.log('📥 Fetching liked songs for recently played conversion...')
      const { data: likedData } = await supabase
        .from('liked_songs')
        .select('song_id')
        .eq('user_id', userId)
      
      const userLikedSongs = new Set<number>()
      if (likedData) {
        likedData.forEach(item => userLikedSongs.add(item.song_id))
      }

      // Convert to Song format
      const recentSongs = historyData
        .filter(item => item.songs) // Ensure song data exists
        .map(item => {
          const songObj = Array.isArray(item.songs) ? item.songs[0] : item.songs;
          return convertDatabaseSong(songObj, userLikedSongs.has(item.song_id));
        });

      setRecentlyPlayedSongs(recentSongs)
      console.log('✅ Set recently played songs:', recentSongs.length)
    } catch (error) {
      console.error('❌ Error fetching recently played songs:', error)
      setRecentlyPlayedSongs([])
    }
  }

  // Fetch user playlists
  const fetchPlaylists = async (userId: string) => {
    try {
      console.log('📥 Fetching playlists for user:', userId)
      const { data: playlistsData, error } = await supabase
        .from('playlists')
        .select(`
          id,
          name,
          playlist_songs (
            songs (*)
          )
        `)
        .eq('user_id', userId)

      if (error) {
        console.error('❌ Error fetching playlists:', error)
        throw error
      }

      const convertedPlaylists: Playlist[] = playlistsData?.map(playlist => {
        const playlistSongs = playlist.playlist_songs?.map((ps: any) => 
          convertDatabaseSong(ps.songs, likedSongs.has(ps.songs.file_id))
        ) || []

        return {
          id: playlist.id.toString(),
          name: playlist.name,
          songCount: playlistSongs.length,
          image: playlistSongs[0]?.image || 'https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=300',
          songs: playlistSongs
        }
      }) || []

      setPlaylists(convertedPlaylists)
      console.log('✅ Set playlists:', convertedPlaylists.length)
    } catch (error) {
      console.error('❌ Error fetching playlists:', error)
    }
  }

  // Toggle like song
  const toggleLike = async (songId: string) => {
    const userId = getUserId()
    if (!userId) {
      console.log('❌ No user ID available for toggling like')
      return
    }

    const songFileId = parseInt(songId);
    const isCurrentlyLiked = likedSongs.has(songFileId);

    try {
      console.log(`${isCurrentlyLiked ? '💔' : '❤️'} Toggling like for song:`, songId, 'User:', userId)
      
      if (isCurrentlyLiked) {
        // Remove from liked_songs
        const { error } = await supabase
          .from('liked_songs')
          .delete()
          .eq('user_id', userId)
          .eq('song_id', songFileId);

        if (error) {
          console.error('❌ Error removing like:', error)
          throw error
        }

        // Decrement likes
        await supabase.rpc('decrement_song_likes', { song_file_id: songFileId });

        setLikedSongs(prev => {
          const newSet = new Set(prev);
          newSet.delete(songFileId);
          return newSet;
        });
        console.log('✅ Song unliked successfully')
      } else {
        // Add to liked_songs
        const { error } = await supabase
          .from('liked_songs')
          .insert({
            user_id: userId,
            song_id: songFileId,
          });

        if (error) {
          console.error('❌ Error adding like:', error)
          throw error
        }

        // Increment likes
        await supabase.rpc('increment_song_likes', { song_file_id: songFileId });

        setLikedSongs(prev => new Set(prev).add(songFileId));
        console.log('✅ Song liked successfully')
      }

      // Update songs state
      setSongs(prevSongs =>
        prevSongs.map(song =>
          song.id === songId
            ? {
                ...song,
                isLiked: !isCurrentlyLiked,
                likes: song.likes + (isCurrentlyLiked ? -1 : 1),
              }
            : song
        )
      );

      // Update playlists state
      setPlaylists(prevPlaylists =>
        prevPlaylists.map(playlist => ({
          ...playlist,
          songs: playlist.songs.map(song =>
            song.id === songId
              ? {
                  ...song,
                  isLiked: !isCurrentlyLiked,
                  likes: song.likes + (isCurrentlyLiked ? -1 : 1),
                }
              : song
          ),
        }))
      );
    } catch (error) {
      console.error('❌ Error toggling like:', error);
    }
  };

  // Create playlist
  const createPlaylist = async (name: string) => {
    const userId = getUserId()
    if (!userId) {
      console.log('❌ No user ID available for creating playlist')
      return
    }

    try {
      console.log('📝 Creating playlist:', name, 'for user:', userId)
      const { data, error } = await supabase
        .from('playlists')
        .insert({
          user_id: userId,
          name
        })
        .select()
        .single()

      if (error) {
        console.error('❌ Error creating playlist:', error)
        throw error
      }

      const newPlaylist: Playlist = {
        id: data.id.toString(),
        name: data.name,
        songCount: 0,
        image: 'https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=300',
        songs: []
      }

      setPlaylists(prev => [...prev, newPlaylist])
      console.log('✅ Playlist created successfully:', newPlaylist.name)
    } catch (error) {
      console.error('❌ Error creating playlist:', error)
    }
  }

  // Delete playlist
  const deletePlaylist = async (playlistId: string) => {
    const userId = getUserId()
    if (!userId) {
      console.log('❌ No user ID available for deleting playlist')
      return
    }

    try {
      console.log('🗑️ Deleting playlist:', playlistId, 'for user:', userId)
      const { error } = await supabase
        .from('playlists')
        .delete()
        .eq('id', parseInt(playlistId))
        .eq('user_id', userId)

      if (error) {
        console.error('❌ Error deleting playlist:', error)
        throw error
      }

      setPlaylists(prev => prev.filter(playlist => playlist.id !== playlistId))
      console.log('✅ Playlist deleted successfully')
    } catch (error) {
      console.error('❌ Error deleting playlist:', error)
    }
  }

  // Rename playlist
  const renamePlaylist = async (playlistId: string, newName: string) => {
    const userId = getUserId()
    if (!userId) {
      console.log('❌ No user ID available for renaming playlist')
      return
    }

    try {
      console.log('✏️ Renaming playlist:', playlistId, 'to:', newName, 'for user:', userId)
      const { error } = await supabase
        .from('playlists')
        .update({ name: newName })
        .eq('id', parseInt(playlistId))
        .eq('user_id', userId)

      if (error) {
        console.error('❌ Error renaming playlist:', error)
        throw error
      }

      setPlaylists(prev => 
        prev.map(playlist => 
          playlist.id === playlistId 
            ? { ...playlist, name: newName }
            : playlist
        )
      )
      console.log('✅ Playlist renamed successfully')
    } catch (error) {
      console.error('❌ Error renaming playlist:', error)
    }
  }

  // Add song to playlist
  const addSongToPlaylist = async (playlistId: string, song: Song) => {
    const userId = getUserId()
    if (!userId) {
      console.log('❌ No user ID available for adding song to playlist')
      return
    }

    try {
      console.log('➕ Adding song:', song.name, 'to playlist:', playlistId, 'for user:', userId)
      const { error } = await supabase
        .from('playlist_songs')
        .insert({
          playlist_id: parseInt(playlistId),
          song_id: song.file_id
        })

      if (error) {
        console.error('❌ Error adding song to playlist:', error)
        throw error
      }

      setPlaylists(prev => 
        prev.map(playlist => {
          if (playlist.id === playlistId) {
            const songExists = playlist.songs.some(s => s.id === song.id)
            if (!songExists) {
              const updatedSongs = [...playlist.songs, song]
              return {
                ...playlist,
                songs: updatedSongs,
                songCount: updatedSongs.length,
                image: updatedSongs[0]?.image || playlist.image
              }
            }
          }
          return playlist
        })
      )
      console.log('✅ Song added to playlist successfully')
    } catch (error) {
      console.error('❌ Error adding song to playlist:', error)
    }
  }

  // Remove song from playlist
  const removeSongFromPlaylist = async (playlistId: string, songId: string) => {
    const userId = getUserId()
    if (!userId) {
      console.log('❌ No user ID available for removing song from playlist')
      return
    }

    try {
      console.log('➖ Removing song:', songId, 'from playlist:', playlistId, 'for user:', userId)
      const { error } = await supabase
        .from('playlist_songs')
        .delete()
        .eq('playlist_id', parseInt(playlistId))
        .eq('song_id', parseInt(songId))

      if (error) {
        console.error('❌ Error removing song from playlist:', error)
        throw error
      }

      setPlaylists(prev => 
        prev.map(playlist => {
          if (playlist.id === playlistId) {
            const updatedSongs = playlist.songs.filter(song => song.id !== songId)
            return {
              ...playlist,
              songs: updatedSongs,
              songCount: updatedSongs.length,
              image: updatedSongs[0]?.image || 'https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=300'
            }
          }
          return playlist
        })
      )
      console.log('✅ Song removed from playlist successfully')
    } catch (error) {
      console.error('❌ Error removing song from playlist:', error)
    }
  }

  // Update last song in user profile
  const updateLastSong = async (songId: string) => {
    const userId = getUserId()
    if (!userId) {
      console.log('❌ No user ID available for updating last song')
      return
    }

    try {
      console.log('📝 Updating last song:', songId, 'for user:', userId)
      const { error } = await supabase
        .from('users')
        .update({ last_song_file_id: parseInt(songId) })
        .eq('id', userId)

      if (error) {
        console.error('❌ Error updating last song:', error)
        throw error
      }
      console.log('✅ Last song updated successfully')
    } catch (error) {
      console.error('❌ Error updating last song:', error)
    }
  }

  // Record listening history with proper time tracking
  const recordListeningHistory = async (songId: string) => {
    const userId = getUserId()
    if (!userId) {
      console.log('❌ No user ID available for recording listening history')
      return
    }

    // If there's a previous song playing, record its listening time
    if (currentSongRef.current && currentSongStartTime) {
      const endTime = new Date();
      const minutesListened = (endTime.getTime() - currentSongStartTime.getTime()) / (1000 * 60);

      if (minutesListened > 0.1) {
        try {
          const minutes = Math.round(minutesListened * 100) / 100;
          console.log('📊 Recording listening time:', minutes, 'minutes for song:', currentSongRef.current)
          const { error } = await supabase.rpc('upsert_history_minutes', {
            user_uuid: userId,
            song_file_id: parseInt(currentSongRef.current),
            minutes: minutes,
          });

          if (error) {
            console.error('❌ Error recording song history:', error);
          } else {
            console.log(`✅ History updated: +${minutes} mins for song ${currentSongRef.current}`);
          }
        } catch (error) {
          console.error('❌ Error recording previous song history:', error);
        }
      }
    }

    // Set new song as current
    currentSongRef.current = songId
    setCurrentSongStartTime(new Date())
    console.log('🎵 Started tracking song:', songId)
    
    // Update last song in user profile
    await updateLastSong(songId)

    try {
      console.log('👁️ Incrementing views for song:', songId)
      await supabase.rpc('increment_song_views', { song_file_id: parseInt(songId) });
      console.log('✅ Views incremented successfully')
    } catch (error) {
      console.error('❌ Error incrementing song views:', error);
    }
  }

  // Stop current song tracking (when player is closed)
  const stopCurrentSongTracking = async () => {
    const userId = getUserId()
    if (currentSongRef.current && currentSongStartTime && userId) {
      const endTime = new Date()
      const minutesListened = (endTime.getTime() - currentSongStartTime.getTime()) / (1000 * 60)
      
      if (minutesListened > 0.1) {
        try {
          const minutes = Math.round(minutesListened * 100) / 100;
          console.log('🛑 Recording final listening time:', minutes, 'minutes for song:', currentSongRef.current)
          const { error } = await supabase.rpc('upsert_history_minutes', {
            user_uuid: userId,
            song_file_id: parseInt(currentSongRef.current),
            minutes: minutes,
          });

          if (error) {
            console.error('❌ Error recording song history on stop:', error);
          } else {
            console.log(`🛑 History updated on stop: +${minutes} mins for song ${currentSongRef.current}`);
          }
        } catch (error) {
          console.error('❌ Error recording final song history:', error);
        }
      }
    }

    currentSongRef.current = null
    setCurrentSongStartTime(null)
    console.log('🛑 Stopped song tracking')
  }

  // Main data loading effect
  useEffect(() => {
    const loadData = async () => {
      const userId = getUserId()
      if (!userId) {
        console.log('❌ No user ID available, resetting data')
        // Reset data when no user
        songsCache.current = null
        likedSongsCache.current = null
        setSongs([])
        setPersonalizedSongs([])
        setTrendingSongs([])
        setPlaylists([])
        setLikedSongs(new Set())
        setRecentlyPlayedSongs([])
        setLastPlayedSong(null)
        setLoading(false)
        setDataLoaded(false)
        return
      }

      // Prevent multiple simultaneous loads
      if (dataLoaded) {
        console.log('📋 Data already loaded, skipping...')
        setLoading(false)
        return
      }

      try {
        console.log('🔄 Loading data for user:', userId)
        setLoading(true)
        
        // Load songs first (most important)
        const songsSuccess = await fetchSongs(userId)
        
        if (songsSuccess) {
          // Load other data in parallel
          await Promise.allSettled([
            fetchPlaylists(userId),
            fetchRecentlyPlayed(userId)
          ])
          
          setDataLoaded(true)
          console.log('✅ All data loaded successfully')
        } else {
          console.error('❌ Failed to load songs, stopping data load')
        }
      } catch (error) {
        console.error('❌ Error loading data:', error)
        // Reset data on error
        setSongs([])
        setPersonalizedSongs([])
        setTrendingSongs([])
        setPlaylists([])
        setLikedSongs(new Set())
        setRecentlyPlayedSongs([])
        setLastPlayedSong(null)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [user?.id]) // Only depend on user ID to prevent loops

  return {
    songs, // all songs
    personalizedSongs, // smart sorted, filtered, and history-excluded list
    trendingSongs, // top 15 trending by views+likes
    playlists,
    likedSongs: songs.filter(song => song.isLiked),
    recentlyPlayedSongs,
    lastPlayedSong,
    loading,
    toggleLike,
    createPlaylist,
    deletePlaylist,
    renamePlaylist,
    addSongToPlaylist,
    removeSongFromPlaylist,
    recordListeningHistory,
    stopCurrentSongTracking,
    refreshData: () => {
      console.log('🔄 Refreshing all data...')
      setDataLoaded(false)
      const userId = getUserId()
      if (userId) {
        fetchSongs(userId)
        fetchPlaylists(userId)
        fetchRecentlyPlayed(userId)
      }
    },
    getPersonalizedSongs,
    getSmartPersonalizedSongs
  }
}
