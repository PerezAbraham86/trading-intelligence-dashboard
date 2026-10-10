'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function Page() {
  const router = useRouter()
  useEffect(() => { router.replace('/') }, [router])
  return <p><Link href="/">Open the dashboard Signal Center</Link></p>
}
