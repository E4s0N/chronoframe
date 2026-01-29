import { withRetry, RetryPresets } from '../../utils/retry'
import { settingsManager } from '../settings/settingsManager'

export interface LocationInfo {
  latitude: number
  longitude: number
  country?: string
  city?: string
  locationName?: string
}

export interface GeocodingProvider {
  reverseGeocode(lat: number, lon: number): Promise<LocationInfo | null>
}

/**
 * Mapbox 地理编码提供者
 * 高精度商业地理编码服务，支持全球范围和多语言
 */
export class MapboxGeocodingProvider implements GeocodingProvider {
  private accessToken: string
  private readonly baseUrl = 'https://api.mapbox.com'
  private lastRequestTime = 0
  private readonly rateLimitMs = 100 // Mapbox 默认速率限制为 1000/分钟，约60ms间隔

  constructor(accessToken: string) {
    this.accessToken = accessToken
  }

  async reverseGeocode(lat: number, lon: number): Promise<LocationInfo | null> {
    try {
      return await withRetry(
        async () => {
          // 应用速率限制
          await this.applyRateLimit()

          const url = new URL('/search/geocode/v6/reverse', this.baseUrl)
          url.searchParams.set('access_token', this.accessToken)
          url.searchParams.set('longitude', lon.toString())
          url.searchParams.set('latitude', lat.toString())
          url.searchParams.set('types', 'address,place,district,region,country')
          url.searchParams.set('language', 'zh-Hants')

          logger.location.info(`Mapbox API URL: ${url.toString()}`)

          const response = await fetch(url.toString())

          if (!response.ok) {
            throw new Error(
              `Mapbox API error: ${response.status} ${response.statusText}`,
            )
          }

          const data = await response.json()

          if (!data || !data.features || data.features.length === 0) {
            logger.location.warn('Mapbox API returned no features')
            return null
          }

          // 取第一个最相关的结果
          const feature = data.features[0]
          const properties = feature.properties || {}
          const context = properties.context || {}

          // 提取国家信息
          const country = context.country?.name

          // 提取城市信息（优先级：locality > place > locality > district > region）
          const city =
            context.locality?.name ||
            context.place?.name ||
            context.locality?.name ||
            context.district?.name ||
            context.region?.name

          // 构建位置名称
          const locationName = properties.place_formatted || properties.name

          logger.location.success(
            `Successfully geocoded location: ${city}, ${country}`,
          )
          return {
            latitude: lat,
            longitude: lon,
            country,
            city,
            locationName,
          }
        },
        {
          ...RetryPresets.network,
          timeout: 10000,
          delayStrategy: 'exponential',
        },
        logger.location,
      )
    } catch (error) {
      logger.location.error(
        'Mapbox reverse geocoding failed after all retries:',
        error,
      )
      return null
    }
  }

  private async applyRateLimit(): Promise<void> {
    const now = Date.now()
    const timeSinceLastRequest = now - this.lastRequestTime

    if (timeSinceLastRequest < this.rateLimitMs) {
      const delay = this.rateLimitMs - timeSinceLastRequest
      await new Promise((resolve) => setTimeout(resolve, delay))
    }

    this.lastRequestTime = Date.now()
  }
}

/**
 * OpenStreetMap Nominatim API 地理编码提供者
 * 免费的地理编码服务，适合开发和小规模使用
 */
export class NominatimGeocodingProvider implements GeocodingProvider {
  private readonly baseUrl: string
  private readonly userAgent = 'chronoframe/1.0'
  private lastRequestTime = 0
  private readonly rateLimitMs = 1000 // Nominatim 要求至少1秒间隔

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || 'https://nominatim.openstreetmap.org'
  }

  async reverseGeocode(lat: number, lon: number): Promise<LocationInfo | null> {
    try {
      return await withRetry(
        async () => {
          // 应用速率限制
          await this.applyRateLimit()

          const url = new URL('/reverse', this.baseUrl)
          url.searchParams.set('lat', lat.toString())
          url.searchParams.set('lon', lon.toString())
          url.searchParams.set('format', 'json')
          url.searchParams.set('addressdetails', '1')
          url.searchParams.set('accept-language', 'zh-CN,zh,en')

          const response = await fetch(url.toString(), {
            headers: {
              'User-Agent': this.userAgent,
            },
          })

          if (!response.ok) {
            throw new Error(
              `Nominatim API error: ${response.status} ${response.statusText}`,
            )
          }

          const data = await response.json()

          if (!data || data.error) {
            throw new Error(`Nominatim API returned error: ${data?.error}`)
          }

          const address = data.address || {}

          // 提取国家信息
          const country = address.country || address.country_code?.toUpperCase()

          // 提取城市信息（优先级：district > city > town > county > state > village > hamlet）
          // 适配中国行政区划
          const city =
            address.district ||
            address.city ||
            address.town ||
            address.county ||
            address.state ||
            address.village ||
            address.hamlet

          // 构建位置名称
          const locationName = data.display_name

          return {
            latitude: lat,
            longitude: lon,
            country,
            city,
            locationName,
          }
        },
        {
          ...RetryPresets.network,
          timeout: 15000, // Nominatim 可能比较慢
          delayStrategy: 'linear', // 线性退避，避免过快重试
        },
        logger.location,
      )
    } catch (error) {
      logger.location.error(
        'Nominatim reverse geocoding failed after all retries:',
        error,
      )
      return null
    }
  }

  private async applyRateLimit(): Promise<void> {
    const now = Date.now()
    const timeSinceLastRequest = now - this.lastRequestTime

    if (timeSinceLastRequest < this.rateLimitMs) {
      const delay = this.rateLimitMs - timeSinceLastRequest
      await new Promise((resolve) => setTimeout(resolve, delay))
    }

    this.lastRequestTime = Date.now()
  }
}

/**
 * 高德地图地理编码提供者
 * 适用于中国的地理编码服务，支持中文地址
 */
export class AMapGeocodingProvider implements GeocodingProvider {
  private apiKey: string
  private readonly convertBaseUrl = 'https://restapi.amap.com/v3/assistant/coordinate/convert'
  private readonly regeoBaseUrl = 'https://restapi.amap.com/v3/geocode/regeo'
  private lastRequestTime = 0
  private readonly rateLimitMs = 100 // 高德地图API限制为每秒100次请求

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async reverseGeocode(lat: number, lon: number): Promise<LocationInfo | null> {
    try {
      return await withRetry(
        async () => {
          // 应用速率限制
          await this.applyRateLimit()

          // 验证经纬度
          if (
            typeof lat !== 'number' ||
            isNaN(lat) ||
            typeof lon !== 'number' ||
            isNaN(lon) ||
            lat < -90 ||
            lat > 90 ||
            lon < -180 ||
            lon > 180
          ) {
            logger.location.warn(`Invalid coordinates provided: ${lat}, ${lon}`)
            return null
          }

          // 格式化坐标（小数点后不超过6位）
          const formatCoordinate = (coord: number): string => {
            return coord.toFixed(6)
          }

          // 1. 坐标转换（GPS 转高德坐标）
          const formattedLongitude = formatCoordinate(lon)
          const formattedLatitude = formatCoordinate(lat)
          
          const convertUrl = new URL(this.convertBaseUrl)
          convertUrl.searchParams.set('key', this.apiKey)
          convertUrl.searchParams.set('locations', `${formattedLongitude},${formattedLatitude}`)
          convertUrl.searchParams.set('coordsys', 'gps')

          logger.location.info(`AMap coordinate conversion URL: ${convertUrl.toString()}`)

          const convertResponse = await fetch(convertUrl.toString())
          if (!convertResponse.ok) {
            throw new Error(
              `AMap coordinate conversion API error: ${convertResponse.status} ${convertResponse.statusText}`,
            )
          }

          const convertData = await convertResponse.json()
          if (convertData.status !== '1' || !convertData.locations) {
            logger.location.warn(`AMap coordinate conversion failed: ${convertData.info || 'Unknown error'}`)
            return null
          }

          const [convertedLongitude, convertedLatitude] = convertData.locations.split(',')

          // 2. 逆地理编码（获取地址）
          const regeoUrl = new URL(this.regeoBaseUrl)
          regeoUrl.searchParams.set('key', this.apiKey)
          regeoUrl.searchParams.set('location', `${convertedLongitude},${convertedLatitude}`)

          logger.location.info(`AMap reverse geocoding URL: ${regeoUrl.toString()}`)

          const regeoResponse = await fetch(regeoUrl.toString())
          if (!regeoResponse.ok) {
            throw new Error(
              `AMap reverse geocoding API error: ${regeoResponse.status} ${regeoResponse.statusText}`,
            )
          }

          const regeoData = await regeoResponse.json()
          if (regeoData.status !== '1' || !regeoData.regeocode) {
            logger.location.warn(`AMap reverse geocoding failed: ${regeoData.info || 'No regeocode data'}`)
            return null
          }

          const { addressComponent, formatted_address } = regeoData.regeocode
          const { province, city, district } = addressComponent

          // 构建位置名称
          const locationName = formatted_address

          logger.location.success(
            `Successfully geocoded location with AMap: ${province}, ${city}`,
          )
          return {
            latitude: lat,
            longitude: lon,
            country: '中国', // 高德地图主要覆盖中国区域
            city: city || district || province, // 优先使用城市，否则使用区县或省份
            locationName,
          }
        },
        {
          ...RetryPresets.network,
          timeout: 15000, // 设置超时时间为15秒
          delayStrategy: 'exponential', // 指数退避策略
        },
        logger.location,
      )
    } catch (error) {
      logger.location.error(
        'AMap reverse geocoding failed after all retries:',
        error,
      )
      return null
    }
  }

  private async applyRateLimit(): Promise<void> {
    const now = Date.now()
    const timeSinceLastRequest = now - this.lastRequestTime

    if (timeSinceLastRequest < this.rateLimitMs) {
      const delay = this.rateLimitMs - timeSinceLastRequest
      await new Promise((resolve) => setTimeout(resolve, delay))
    }

    this.lastRequestTime = Date.now()
  }
}

/**
 * 创建地理编码提供者实例
 * @description 优先使用 AMap（高德地图），如果未配置则使用 Mapbox，最后回退到 Nominatim
 */
async function createGeocodingProvider(): Promise<GeocodingProvider> {
  // 尝试使用高德地图API密钥
  const amapApiKey = await settingsManager.get<string>(
    'location',
    'amap.apiKey',
  )

  if (amapApiKey) {
    return new AMapGeocodingProvider(amapApiKey)
  }

  // 其次尝试使用 Mapbox
  const mapboxToken = await settingsManager.get<string>(
    'location',
    'mapbox.token',
  )

  if (mapboxToken) {
    return new MapboxGeocodingProvider(mapboxToken)
  }

  // 最后回退到 Nominatim 提供者
  return new NominatimGeocodingProvider(
    (await settingsManager.get<string>('location', 'nominatim.baseUrl')) ||
      undefined,
  )
}

export async function extractLocationFromGPS(
  gpsLatitude?: number,
  gpsLongitude?: number,
  provider?: GeocodingProvider,
): Promise<LocationInfo | null> {
  if (!gpsLatitude || !gpsLongitude) {
    return null
  }

  // 验证坐标范围
  if (Math.abs(gpsLatitude) > 90 || Math.abs(gpsLongitude) > 180) {
    logger.location.warn(
      `Invalid GPS coordinates: ${gpsLatitude}, ${gpsLongitude}`,
    )
    return null
  }

  logger.location.info(
    `Reverse geocoding coordinates: ${gpsLatitude}, ${gpsLongitude}`,
  )

  // 如果没有指定提供者，使用默认提供者
  const geocodingProvider = provider || (await createGeocodingProvider())

  try {
    const locationInfo = await geocodingProvider.reverseGeocode(
      gpsLatitude,
      gpsLongitude,
    )

    if (locationInfo) {
      logger.location.success(
        `Location found: ${locationInfo.city}, ${locationInfo.country}`,
      )
    } else {
      logger.location.warn('No location found for coordinates')
    }

    return locationInfo
  } catch (error) {
    logger.location.error('Location extraction failed:', error)
    return null
  }
}

/**
 * 解析EXIF GPS数据为十进制度数
 */
export function parseGPSCoordinates(exifData: any): {
  latitude?: number
  longitude?: number
} {
  try {
    let latitude: number | undefined
    let longitude: number | undefined

    // 尝试从GPSLatitude和GPSLongitude获取
    if (exifData.GPSLatitude && exifData.GPSLongitude) {
      latitude = parseFloat(exifData.GPSLatitude.toString())
      longitude = parseFloat(exifData.GPSLongitude.toString())
    }

    // 如果上面的方法失败，尝试从GPSCoordinates获取
    if ((!latitude || !longitude) && exifData.GPSCoordinates) {
      const coords = exifData.GPSCoordinates.toString()
      const match = coords.match(/([-+]?\d+\.?\d*)[°,\s]+([-+]?\d+\.?\d*)/)
      if (match) {
        latitude = parseFloat(match[1])
        longitude = parseFloat(match[2])
      }
    }

    // 应用GPS参考（南纬为负，西经为负）
    if (latitude && exifData.GPSLatitudeRef === 'S') {
      latitude = -Math.abs(latitude)
    }
    if (longitude && exifData.GPSLongitudeRef === 'W') {
      longitude = -Math.abs(longitude)
    }

    return { latitude, longitude }
  } catch (error) {
    logger.location.error('Failed to parse GPS coordinates:', error)
    return {}
  }
}
