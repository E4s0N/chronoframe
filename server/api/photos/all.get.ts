import { desc } from 'drizzle-orm'

export default eventHandler(async (event) => {
  // 返回所有照片，不管show属性为何值，用于后台管理面板
  return useDB()
    .select()
    .from(tables.photos)
    .orderBy(desc(tables.photos.dateTaken))
    .all()
})