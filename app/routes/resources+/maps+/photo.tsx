import { invariant } from '@epic-web/invariant'
import { type LoaderFunctionArgs } from 'react-router'

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const photoRef = url.searchParams.get('photoRef')
  const maxWidth = url.searchParams.get('maxWidth') || '400'
  const maxHeight = url.searchParams.get('maxHeight') || '300'

  invariant(photoRef, 'photoRef is required')
  invariant(process.env.GOOGLE_PLACES_API_KEY, 'GOOGLE_PLACES_API_KEY must be set')
  
  const photoUrl = new URL('https://maps.googleapis.com/maps/api/place/photo')
  photoUrl.searchParams.append('photoreference', photoRef)
  photoUrl.searchParams.append('maxwidth', maxWidth)
  photoUrl.searchParams.append('maxheight', maxHeight)
  photoUrl.searchParams.append('key', process.env.GOOGLE_PLACES_API_KEY)

  const response = await fetch(photoUrl.toString())
  
  if (!response.ok) {
    throw new Response('Failed to fetch photo', { status: response.status })
  }

  const headers = new Headers()
  headers.set('Cache-Control', 'public, max-age=86400') // 24 hours
  headers.set('Content-Type', response.headers.get('Content-Type') || 'image/jpeg')

  return new Response(response.body, {
    status: 200,
    headers
  })
} 