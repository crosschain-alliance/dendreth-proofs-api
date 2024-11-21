const jsonStringify = (obj) => {
  return JSON.stringify(obj, (key, value) => (typeof value === 'bigint' ? value.toString() : value))
}

const getLatestLCUpdateLog = (LCUpdateLogs) => {
  if (!LCUpdateLogs || LCUpdateLogs.length === 0) {
    return null // Return null if the array is empty or undefined
  }

  // Parse logs and filter logs where topics[1] starts with the required prefix
  const parsedLogs = LCUpdateLogs.map((log) => JSON.parse(jsonStringify(log))).filter(
    (log) => log.topics.length > 1 && log.topics[1].slice(0, 34) === '0x00000000000000000000000000000000'
  )

  // Sort by topics[1] in descending order
  parsedLogs.sort((a, b) => {
    const topicA = BigInt(a.topics[1])
    const topicB = BigInt(b.topics[1])

    if (topicA > topicB) return -1
    if (topicA < topicB) return 1
    return 0
  })

  // Return the log with the largest topics[1] (latest block number), or null if no valid logs
  const latestLog = parsedLogs.length > 0 ? parsedLogs[0] : null
  return latestLog
}

export { jsonStringify, getLatestLCUpdateLog }
