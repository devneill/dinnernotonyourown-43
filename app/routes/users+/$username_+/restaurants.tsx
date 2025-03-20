import { invariant } from '@epic-web/invariant'
import { type ActionFunctionArgs, type LoaderFunctionArgs } from 'react-router'
import { useLoaderData, useFetcher, useNavigation, useSearchParams, Link } from 'react-router'
import { z } from 'zod'
import { getAllRestaurantDetails, joinDinnerGroup, leaveDinnerGroup, type RestaurantWithDetails } from '#app/utils/restaurants.server'
import { requireUserId } from '#app/utils/auth.server'
import { cn } from '#app/utils/misc'
import { MapPinIcon, StarIcon, MapIcon } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#app/components/ui/card'
import { Toggle } from '#app/components/ui/toggle'
import { Badge } from '#app/components/ui/badge'
import { Button } from '#app/components/ui/button'
import { StatusButton } from '#app/components/ui/status-button'

// Filter parameters schema
const FilterParamsSchema = z.object({
  distance: z.coerce.number().min(1).max(10).optional(),
  rating: z.coerce.number().min(1).max(5).optional(),
  price: z.coerce.number().min(1).max(4).optional(),
})

// Action intent schema
const ActionSchema = z.discriminatedUnion('intent', [
  z.object({
    intent: z.literal('join'),
    restaurantId: z.string(),
  }),
  z.object({
    intent: z.literal('leave'),
  }),
])

type LoaderData = {
  restaurantsWithAttendance: RestaurantWithDetails[]
  restaurantsNearby: RestaurantWithDetails[]
  filters: {
    distance?: number
    rating?: number
    price?: number
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const userId = await requireUserId(request)
  
  // Hilton SLC coordinates
  const HILTON_LAT = 40.7596
  const HILTON_LNG = -111.8867
  
  // Parse filter parameters from URL
  const url = new URL(request.url)
  const filterParams = FilterParamsSchema.safeParse({
    distance: url.searchParams.get('distance') ?? undefined,
    rating: url.searchParams.get('rating') ?? undefined,
    price: url.searchParams.get('price') ?? undefined,
  })
  
  // Get base radius from distance filter or default to 1 mile
  const radius = filterParams.success && filterParams.data.distance
    ? filterParams.data.distance * 1600 // Convert miles to meters
    : 1600 // Default to 1 mile
  
  // Fetch all restaurant details
  const restaurants = await getAllRestaurantDetails({
    lat: HILTON_LAT,
    lng: HILTON_LNG,
    userId,
    radius: radius * 2, // Double the radius to ensure we have enough to filter
  })
  
  // Split restaurants into those with attendees and those without
  const restaurantsWithAttendance = restaurants
    .filter(r => r.attendeeCount > 0)
    .sort((a, b) => b.attendeeCount - a.attendeeCount)
  
  // Filter nearby restaurants
  const restaurantsNearby = restaurants
    .filter(r => {
      // Only include restaurants with no attendees
      if (r.attendeeCount > 0) return false
      
      // Apply distance filter
      if (filterParams.success && filterParams.data.distance) {
        if (r.distance > filterParams.data.distance) return false
      } else {
        // Default filter of 1 mile
        if (r.distance > 1) return false
      }
      
      // Apply rating filter
      if (filterParams.success && filterParams.data.rating) {
        if (!r.rating || r.rating < filterParams.data.rating) return false
      }
      
      // Apply price filter
      if (filterParams.success && filterParams.data.price) {
        if (r.priceLevel !== filterParams.data.price) return false
      }
      
      return true
    })
    // Sort by rating (desc) and distance (asc) as tiebreaker
    .sort((a, b) => {
      const ratingDiff = (b.rating || 0) - (a.rating || 0)
      return ratingDiff !== 0 ? ratingDiff : a.distance - b.distance
    })
    // Limit to top 30 results
    .slice(0, 30)
  
  return {
    restaurantsWithAttendance,
    restaurantsNearby,
    filters: filterParams.success ? filterParams.data : {},
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const userId = await requireUserId(request)
  
  const formData = await request.formData()
  const actionResult = ActionSchema.safeParse(Object.fromEntries(formData))
  
  if (!actionResult.success) {
    return { status: 'error', message: 'Invalid form data' }
  }
  
  const { intent } = actionResult.data
  
  if (intent === 'join') {
    const { restaurantId } = actionResult.data
    await joinDinnerGroup({ userId, restaurantId })
    return { status: 'success', message: 'Joined dinner group' }
  }
  
  if (intent === 'leave') {
    await leaveDinnerGroup({ userId })
    return { status: 'success', message: 'Left dinner group' }
  }
  
  return { status: 'error', message: 'Invalid intent' }
}

function RestaurantCard({ restaurant }: { restaurant: RestaurantWithDetails }) {
  const fetcher = useFetcher()
  const isJoining = fetcher.state === 'submitting' && 
    fetcher.formData?.get('intent') === 'join' && 
    fetcher.formData?.get('restaurantId') === restaurant.id
  const isLeaving = fetcher.state === 'submitting' && 
    fetcher.formData?.get('intent') === 'leave' && 
    restaurant.isUserAttending

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="h-full overflow-hidden">
        <div className="relative h-40 bg-muted">
          {restaurant.photoRef ? (
            <img 
              src={`/resources/maps/photo?photoRef=${restaurant.photoRef}`} 
              alt={restaurant.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-muted">
              <p className="text-muted-foreground">No image available</p>
            </div>
          )}
          <div className="absolute right-2 top-2 flex flex-col gap-2">
            {restaurant.rating ? (
              <Badge className="flex items-center gap-1 bg-amber-500 text-white">
                <StarIcon className="h-3 w-3" />
                {restaurant.rating.toFixed(1)}
              </Badge>
            ) : null}
            {restaurant.priceLevel ? (
              <Badge className="bg-slate-700 text-white">
                {'$'.repeat(restaurant.priceLevel)}
              </Badge>
            ) : null}
          </div>
        </div>
        <CardHeader className="p-4 pb-0">
          <CardTitle className="line-clamp-1 text-lg">{restaurant.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 p-4 pt-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapPinIcon className="h-4 w-4" />
            <span>{restaurant.distance} mi</span>
          </div>
          <div className="flex items-center gap-2">
            <a 
              href={restaurant.mapsUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm text-blue-600 hover:underline"
            >
              <MapIcon className="h-4 w-4" />
              Directions
            </a>
          </div>
          {restaurant.attendeeCount > 0 && (
            <div className="text-sm font-medium">
              {restaurant.attendeeCount} {restaurant.attendeeCount === 1 ? 'person' : 'people'} attending
            </div>
          )}
        </CardContent>
        <CardFooter className="p-4 pt-0">
          <fetcher.Form method="post" className="w-full">
            {restaurant.isUserAttending ? (
              <>
                <input type="hidden" name="intent" value="leave" />
                <StatusButton
                  type="submit"
                  variant="destructive"
                  status={isLeaving ? 'pending' : 'idle'}
                  className="w-full"
                >
                  Leave
                </StatusButton>
              </>
            ) : (
              <>
                <input type="hidden" name="intent" value="join" />
                <input type="hidden" name="restaurantId" value={restaurant.id} />
                <StatusButton
                  type="submit"
                  variant="default"
                  status={isJoining ? 'pending' : 'idle'}
                  className="w-full"
                >
                  Join
                </StatusButton>
              </>
            )}
          </fetcher.Form>
        </CardFooter>
      </Card>
    </motion.div>
  )
}

function Filters() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigation = useNavigation()
  const isChangingFilters = navigation.state === 'loading'

  const distanceFilter = searchParams.get('distance')
  const ratingFilter = searchParams.get('rating')
  const priceFilter = searchParams.get('price')

  const updateFilter = (name: string, value: string | null) => {
    const newParams = new URLSearchParams(searchParams)
    if (value === null) {
      newParams.delete(name)
    } else {
      newParams.set(name, value)
    }
    setSearchParams(newParams, { preventScrollReset: true, replace: true })
  }

  return (
    <div className="mb-6 space-y-4">
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Distance</h3>
        <div className="flex gap-2">
          {[1, 2, 5, 10].map(distance => (
            <Toggle
              key={distance}
              pressed={distanceFilter === distance.toString()}
              onPressedChange={pressed => updateFilter('distance', pressed ? distance.toString() : null)}
              className="flex-1"
              disabled={isChangingFilters}
            >
              {distance} mi
            </Toggle>
          ))}
        </div>
      </div>
      
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Rating</h3>
        <div className="flex gap-2">
          {[1, 2, 3, 4].map(rating => (
            <Toggle
              key={rating}
              pressed={ratingFilter === rating.toString()}
              onPressedChange={pressed => updateFilter('rating', pressed ? rating.toString() : null)}
              className="flex-1"
              disabled={isChangingFilters}
            >
              {'⭐'.repeat(rating)}
            </Toggle>
          ))}
        </div>
      </div>
      
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Price</h3>
        <div className="flex gap-2">
          {[1, 2, 3, 4].map(price => (
            <Toggle
              key={price}
              pressed={priceFilter === price.toString()}
              onPressedChange={pressed => updateFilter('price', pressed ? price.toString() : null)}
              className="flex-1"
              disabled={isChangingFilters}
            >
              {'$'.repeat(price)}
            </Toggle>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function RestaurantsPage() {
  const { restaurantsWithAttendance, restaurantsNearby } = useLoaderData() as LoaderData
  const hasUserAttending = restaurantsWithAttendance.some(r => r.isUserAttending)

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-8 text-center">
        <h1 className="text-2xl font-bold">
          {hasUserAttending 
            ? "You've got dinner plans! 🎉" 
            : "You're having dinner on your own 🧘‍♂️"}
        </h1>
      </header>

      <div className="mb-12">
        <AnimatePresence>
          {restaurantsWithAttendance.length > 0 ? (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3">
              {restaurantsWithAttendance.map(restaurant => (
                <RestaurantCard key={restaurant.id} restaurant={restaurant} />
              ))}
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex h-[320px] items-center justify-center rounded-lg border-2 border-dashed border-gray-300"
            >
              <p className="text-lg text-gray-500">
                Everyone is having dinner on their own 🤷
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <section>
        <h2 className="mb-4 text-xl font-bold">Nearby Restaurants</h2>
        <Filters />
        
        <AnimatePresence>
          <motion.div 
            layout
            className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3"
          >
            {restaurantsNearby.map(restaurant => (
              <RestaurantCard key={restaurant.id} restaurant={restaurant} />
            ))}
          </motion.div>
        </AnimatePresence>
        
        {restaurantsNearby.length === 0 && (
          <p className="mt-8 text-center text-gray-500">
            No restaurants found with the current filters. Try adjusting your filters.
          </p>
        )}
      </section>
    </div>
  )
} 