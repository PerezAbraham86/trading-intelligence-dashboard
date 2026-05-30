import { redirect } from 'next/navigation'

export default function Page() {
  // Signals are merged into the live dashboard / Signal Center.
  // The current dashboard page remains untouched.
  redirect('/')
}
