export type DrillPagination = {
  page?: number
  totalPages?: number
  hasMore?: boolean
}

export type DrillPage<T> = {
  items: T[]
  pagination?: DrillPagination
}

export async function loadAllDrillPages<T>(
  loadPage: (page: number) => Promise<DrillPage<T>>,
): Promise<T[]> {
  const items: T[] = []
  let page = 1

  while (true) {
    const result = await loadPage(page)
    items.push(...result.items)

    const { pagination } = result
    if (!pagination) break

    const currentPage = pagination.page ?? page
    if (typeof pagination.totalPages === "number") {
      if (currentPage >= pagination.totalPages) break
    } else if (pagination.hasMore !== true) {
      break
    }

    page = currentPage + 1
  }

  return items
}
