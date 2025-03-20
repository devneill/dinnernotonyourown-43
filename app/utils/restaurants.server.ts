import { cachified } from './cache.server'
import { lruCache } from './cache.server'
import { prisma } from './db.server'
import { getNearbyRestaurants } from './providers/google-places.server'

// Cache TTLs
const RESTAURANT_CACHE_TTL = 1000 * 60 * 60 * 24 // 24 hours
const ATTENDANCE_CACHE_TTL = 1000 * 15 // 15 seconds - short to ensure real-time attendance

export interface RestaurantWithDetails {
  id: string
  name: string
  priceLevel?: number | null
  rating?: number | null
  lat: number
  lng: number
  photoRef?: string | null
  mapsUrl: string
  distance: number // in miles
  attendeeCount: number
  isUserAttending: boolean
}

/**
 * Calculate distance between two coordinates in miles
 */
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRadians = (deg: number) => deg * (Math.PI / 180)
  const R = 3958.8 // Earth's radius in miles
  const dLat = toRadians(lat2 - lat1)
  const dLng = toRadians(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
    Math.cos(toRadians(lat2)) *
    Math.sin(dLng / 2) *
    Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return parseFloat((R * c).toFixed(2)) // Round to 2 decimal places
}

/**
 * Fetches restaurants from Google Places API and upserts them into the database
 */
async function fetchAndUpsertRestaurants(lat: number, lng: number, radius: number) {
  const restaurants = await getNearbyRestaurants({ lat, lng, radius })

  // Batch upsert restaurants
  return await Promise.all(
    restaurants.map(async (restaurant) => {
      return prisma.restaurant.upsert({
        where: { id: restaurant.id },
        update: {
          name: restaurant.name,
          priceLevel: restaurant.priceLevel,
          rating: restaurant.rating,
          lat: restaurant.lat,
          lng: restaurant.lng,
          photoRef: restaurant.photoRef,
          mapsUrl: restaurant.mapsUrl,
          updatedAt: new Date(),
        },
        create: {
          id: restaurant.id,
          name: restaurant.name,
          priceLevel: restaurant.priceLevel,
          rating: restaurant.rating,
          lat: restaurant.lat,
          lng: restaurant.lng,
          photoRef: restaurant.photoRef,
          mapsUrl: restaurant.mapsUrl,
        },
      })
    })
  )
}

/**
 * Get all restaurant details with attendance information
 */
export async function getAllRestaurantDetails({
  lat,
  lng,
  userId,
  radius = 1600,
}: {
  lat: number
  lng: number
  userId: string
  radius?: number
}): Promise<RestaurantWithDetails[]> {
  // First, get user's current attendance if any
  const userAttendance = await getUserAttendingRestaurant(userId)

  // Fetch and cache restaurants
  const restaurants = await cachified({
    key: `restaurants-${lat}-${lng}-${radius}`,
    ttl: RESTAURANT_CACHE_TTL,
    cache: lruCache,
    async getFreshValue() {
      const restaurantsFromApi = await fetchAndUpsertRestaurants(lat, lng, radius)
      return restaurantsFromApi
    },
  })

  // Get real-time attendance counts
  const restaurantIds = restaurants.map((r) => r.id)
  const attendeeCounts = await getAttendeeCounts(restaurantIds)

  // Build full restaurant details with distance and attendance info
  return restaurants.map((restaurant) => {
    const distance = calculateDistance(lat, lng, restaurant.lat, restaurant.lng)
    const attendeeCount = attendeeCounts[restaurant.id] || 0
    const isUserAttending = userAttendance?.dinnerGroup?.restaurantId === restaurant.id

    return {
      ...restaurant,
      distance,
      attendeeCount,
      isUserAttending,
    }
  })
}

/**
 * Get number of attendees for each restaurant
 */
async function getAttendeeCounts(restaurantIds: string[]): Promise<Record<string, number>> {
  const dinnerGroups = await prisma.dinnerGroup.findMany({
    where: {
      restaurantId: {
        in: restaurantIds,
      },
    },
    include: {
      _count: {
        select: {
          attendees: true,
        },
      },
    },
  })

  return dinnerGroups.reduce(
    (counts, group) => {
      counts[group.restaurantId] = group._count.attendees
      return counts
    },
    {} as Record<string, number>
  )
}

/**
 * Get the restaurant the user is currently attending
 */
export async function getUserAttendingRestaurant(userId: string) {
  return prisma.attendee.findFirst({
    where: { userId },
    select: {
      dinnerGroup: {
        select: {
          restaurantId: true,
        },
      },
    },
  })
}

/**
 * Join a dinner group for a restaurant
 */
export async function joinDinnerGroup({
  userId,
  restaurantId,
}: {
  userId: string
  restaurantId: string
}) {
  // First, leave any existing dinner group
  await leaveDinnerGroup({ userId })

  // Find or create dinner group for this restaurant
  let dinnerGroup = await prisma.dinnerGroup.findUnique({
    where: { restaurantId },
  })

  if (!dinnerGroup) {
    dinnerGroup = await prisma.dinnerGroup.create({
      data: {
        restaurantId,
      },
    })
  }

  // Add user to the dinner group
  return prisma.attendee.create({
    data: {
      userId,
      dinnerGroupId: dinnerGroup.id,
    },
  })
}

/**
 * Leave the current dinner group
 */
export async function leaveDinnerGroup({ userId }: { userId: string }) {
  // Find user's attendance
  const attendee = await prisma.attendee.findFirst({
    where: { userId },
    include: {
      dinnerGroup: true,
    },
  })

  if (!attendee) return null

  // Delete the attendance
  await prisma.attendee.delete({
    where: { id: attendee.id },
  })

  // Check if dinner group is now empty and delete if it is
  const remainingAttendees = await prisma.attendee.count({
    where: { dinnerGroupId: attendee.dinnerGroupId },
  })

  if (remainingAttendees === 0) {
    await prisma.dinnerGroup.delete({
      where: { id: attendee.dinnerGroupId },
    })
  }

  return attendee.dinnerGroup.restaurantId
} 