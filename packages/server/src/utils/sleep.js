const sleep = (_ms) =>
  new Promise((_resolve) =>
    setTimeout(() => {
      _resolve()
    }, _ms)
  )

export default sleep
