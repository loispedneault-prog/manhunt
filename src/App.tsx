import { useCallback, useState } from 'react'
import { loadGameId, loadProfile, saveGameId, type Profile } from './lib/profile'
import { Create } from './screens/Create'
import { GameRoot } from './screens/GameRoot'
import { Home } from './screens/Home'
import { ProfileScreen } from './screens/ProfileScreen'

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(loadProfile)
  const [gameId, setGameId] = useState<string | null>(loadGameId)
  const [screen, setScreen] = useState<'home' | 'profile' | 'create'>('home')
  const [notice, setNotice] = useState<string | undefined>()

  const enterGame = (id: string, p: Profile) => {
    setProfile(p)
    saveGameId(id)
    setGameId(id)
    setScreen('home')
  }

  const leaveGame = useCallback((msg?: string) => {
    saveGameId(null)
    setGameId(null)
    setNotice(msg)
  }, [])

  if (!profile || screen === 'profile') {
    return (
      <ProfileScreen
        initial={profile}
        onDone={p => {
          setProfile(p)
          setScreen('home')
        }}
        onCancel={profile ? () => setScreen('home') : undefined}
      />
    )
  }

  if (gameId) return <GameRoot key={gameId} gameId={gameId} profile={profile} onLeave={leaveGame} />

  if (screen === 'create') return <Create profile={profile} onCancel={() => setScreen('home')} onCreated={enterGame} />

  return (
    <Home
      key={notice ?? ''}
      profile={profile}
      notice={notice}
      onEditProfile={() => setScreen('profile')}
      onCreate={() => {
        setNotice(undefined)
        setScreen('create')
      }}
      onJoined={enterGame}
    />
  )
}
