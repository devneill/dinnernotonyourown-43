import { invariant } from '@epic-web/invariant'

interface Location {
  lat: number
  lng: number
}

interface NearbyRestaurant {
  id: string
  name: string
  priceLevel?: number
  rating?: number
  lat: number
  lng: number
  photoRef?: string
  mapsUrl: string
}

interface GooglePlacesNearbyResponse {
  status: string
  error_message?: string
  results?: Array<{
    place_id: string
    name: string
    vicinity: string
    types: string[]
    geometry: {
      location: {
        lat: number
        lng: number
      }
    }
  }>
}

interface GooglePlacesDetailsResponse {
  status: string
  error_message?: string
  result?: {
    place_id: string
    name: string
    price_level?: number
    rating?: number
    geometry: {
      location: {
        lat: number
        lng: number
      }
    }
    photos?: Array<{
      photo_reference: string
      width: number
      height: number
    }>
    url?: string
  }
}

export async function getNearbyRestaurants({
  lat,
  lng,
  radius = 1600, // Default 1 mile (1600 meters)
}: {
  lat: number
  lng: number
  radius?: number
}): Promise<NearbyRestaurant[]> {
  invariant(process.env.GOOGLE_PLACES_API_KEY, 'GOOGLE_PLACES_API_KEY must be set')
  const apiKey = process.env.GOOGLE_PLACES_API_KEY

  // Make the initial Nearby Search request
  const nearbySearchURL = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json')
  nearbySearchURL.searchParams.append('location', `${lat},${lng}`)
  nearbySearchURL.searchParams.append('radius', radius.toString())
  nearbySearchURL.searchParams.append('type', 'restaurant')
  nearbySearchURL.searchParams.append('key', apiKey)

  const nearbyResponse = await fetch(nearbySearchURL.toString())
  const nearbyData = await nearbyResponse.json() as GooglePlacesNearbyResponse

  if (nearbyData.status !== 'OK' && nearbyData.status !== 'ZERO_RESULTS') {
    console.error('Google Places API Error:', nearbyData.status, nearbyData.error_message)
    throw new Error(`Google Places API error: ${nearbyData.status}`)
  }

  if (nearbyData.status === 'ZERO_RESULTS' || !nearbyData.results?.length) {
    return []
  }

  // Get detailed information for each restaurant in parallel
  const placeDetailsPromises = nearbyData.results.map(async (place) => {
    const placeId = place.place_id
    const placeDetailsURL = new URL('https://maps.googleapis.com/maps/api/place/details/json')
    placeDetailsURL.searchParams.append('place_id', placeId)
    placeDetailsURL.searchParams.append('fields', 'place_id,name,price_level,rating,geometry,photo,url')
    placeDetailsURL.searchParams.append('key', apiKey)

    const detailsResponse = await fetch(placeDetailsURL.toString())
    const detailsData = await detailsResponse.json() as GooglePlacesDetailsResponse

    if (detailsData.status !== 'OK' || !detailsData.result) {
      console.error(`Error fetching details for place ${placeId}:`, detailsData.status)
      return null
    }

    const result = detailsData.result
    const photoRef = result.photos?.[0]?.photo_reference

    return {
      id: result.place_id,
      name: result.name,
      priceLevel: result.price_level,
      rating: result.rating,
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      photoRef,
      mapsUrl: result.url || `https://maps.google.com/?q=${result.geometry.location.lat},${result.geometry.location.lng}`,
    }
  })

  const restaurantsWithDetails = await Promise.all(placeDetailsPromises)
  return restaurantsWithDetails.filter(Boolean) as NearbyRestaurant[]
} 