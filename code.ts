// Marking with ENV_TO_REPLACE to allow releases to change env to use
const current_env = "production" // ENV_TO_REPLACE

let log = console.log

// @ts-ignore
if (current_env === "production") {
  log = () => {}
}

const getPropertiesForObject = (node) => {
  const props: any = {}
  const shouldExport = node.visible
  // log(node.id, shouldExport, node.children)
  if (!shouldExport) {
    return props
  }
  for(var prop in node) {
    // We don't want the selection property as it's not a document change, only a view/UI one
    if (prop !== "selection") {
      props[prop] = node[prop]
    }
  }
  console.log("## node")
  console.log(node)
  if (node.parent.type === 'PAGE' && node.type === 'FRAME') {
    props.isRootFrame = true
  }
  if (node.parent.type !== 'PAGE' && node.type === 'FRAME') {
    props.isRootFrame = false
  }

  if (node.layoutAlign === 'STRETCH') {
    props.width = '100%'
  }

  // This is a top-level auto-layout frame that should expand to the borders
  if (props.isRootFrame && props.layoutMode === 'VERTICAL' && props.layoutAlign === 'MIN') {
    props.width = '100%'
  }

  // If it's centered, we're in a auto-layout group and we want flexbox to handle
  // things instead
  if (props.layoutAlign === 'CENTER' && node.parent.layoutMode === 'VERTICAL') {
    delete props.x
  }

  // Resolve reactions[i].action.destinationId to point to `./` node-name instead
  log('links', node.reactions.length)
  if (node.reactions.length > 0 &&
    node.reactions[0].action.destinationId &&
    node.reactions[0].action.type === "NODE") {
    const destinationID = node.reactions[0].action.destinationId
    // log('overwriting reaction', destinationID, figma.getNodeById(destinationID).name)
    const nodeName = figma.getNodeById(destinationID).name
    props.linking_to = nodeName
    props.linking_external = false
    log('Had internal links, URL ' + props.linking_to)
  }
  if (node.reactions.length > 0 &&
    node.reactions[0].action.type === "URL") {
    props.linking_to = node.reactions[0].action.url
    props.linking_external = true
    log('Had external links, URL ' + props.linking_to)
  }
  return props
}

function hasOwnProperty<X extends {}, Y extends PropertyKey>
  (obj: X, prop: Y): obj is X & Record<Y, unknown> {
  return obj.hasOwnProperty(prop)
}

const getPropertiesForObjectWithChildren = (node) => {
  const root = getPropertiesForObject(node)
  if (hasOwnProperty(root, 'children') && Array.isArray(root.children)) {
    root.children = root.children.map(getPropertiesForObjectWithChildren)
  }
  return root
}

const getDocumentString = (node) => {
  const res = getPropertiesForObjectWithChildren(node)
  console.log('[getDocumentString]')
  console.log(res)
  return JSON.stringify(res)
}

const messageReplyHandlers: any = {}

const postAndWaitForReply = async (msg_type, content) => {
  const id = (Math.floor(Math.random() * 100) + 1).toString()
  log(`[code:postAndWaitForReply:${id}:${msg_type}] init`)
  return new Promise((resolve) => {
    // log('onmessage')
    // log(figma.ui.onmessage)
    // const oldListener = figma.ui.onmessage
    log(`[code:postAndWaitForReply:${id}:${msg_type}] setting handler`)
    messageReplyHandlers[id] = (msg) => {
      log(`[code:postAndWaitForReply:${id}:${msg_type}] received reply`, msg)
      resolve(msg)
      delete messageReplyHandlers[id]
    }
    log(`[code:postAndWaitForReply:${id}:${msg_type}] posting message`, content)
    figma.ui.postMessage(Object.assign({}, {
      type: msg_type,
      id: id
    }, content))
  })
}

const isNodeVisible = (node) => {
  if (node.visible) {
    return isNodeVisible(node.parent)
  } else {
    if (node.parent) {
      return isNodeVisible(node.parent)
    } else {
      return false
    }
  }
}

function checkSelectedNode() {
  const selected_node = figma.currentPage.selection[0]
  if (selected_node) {
    const isTopLevel = figma.currentPage.id === selected_node.parent.id
    figma.ui.postMessage({
      type: 'selection-change',
      node_type: selected_node.type,
      is_top_level: isTopLevel
    })
  } else {
    figma.ui.postMessage({
      type: 'selection-change'
    })
  }
}

figma.on('selectionchange', () => {
  checkSelectedNode()
})

checkSelectedNode()

// Keep this here, in case we need it in the future.
// Reason we might need it is because figma.on 'selectionchange' sometimes
// takes long time to actually be called, so if the plugin appears sluggish
// when changing selection, we could use the below code instead, doesn't
// have the same problem and doesn't seem to impact CPU too much. Tuning
// of interval might be needed.
// let prev = null
// setInterval(() => {
//   const curr = (figma.currentPage.selection[0] || {}).id
//   // log('checking', curr !== prev)
//   if (curr !== prev) {
//     prev = curr
//     checkSelectedNode()
//   }
// }, 100)

// Calls to "parent.postMessage" from within the HTML page will trigger this
// callback. The callback will be passed the "pluginMessage" property of the
// posted message.
figma.ui.onmessage = async msg => {
  // One way of distinguishing between different types of messages sent from
  // your HTML page is to use an object with a "type" property like this.
  const handlerIDs = Object.keys(messageReplyHandlers)
  log(`[code:onmessage:${msg.type}] got message`)
  log(`[code:handlers]`, msg.id, handlerIDs)
  log(handlerIDs.indexOf(msg.id) !== -1)
  if (handlerIDs.indexOf(msg.id) !== -1) {
    log('Called message handler')
    messageReplyHandlers[msg.id](msg)
    return
  }
  log('[code:handlers] no matching handlers, continuing')

  // Temporarly comment out these
  if (msg.type === 'load-parameter') {
    log(`[code:load-parameter:${msg.key}] loading parameter`)
    const parameter_value = figma.currentPage.getPluginData('parameter_' + msg.key)
    log('parameter.website_id', figma.currentPage.getPluginData('parameter_website_id'))
    log(parameter_value)
    log('posting message')
    log(JSON.stringify(parameter_value))
    log(`[code:load-parameter:${msg.key}] posting value ${JSON.stringify(parameter_value)}`)
    figma.ui.postMessage({
      type: msg.type,
      id: msg.id,
      value: JSON.parse(parameter_value || null)
    })
    return
  }

  if (msg.type === 'set-parameter') {
    const parameter_value = figma.currentPage.setPluginData('parameter_' + msg.key, JSON.stringify(msg.value))
    return
  }

  if (msg.type === 'notify') {
    figma.notify(msg.message.toString())
  }

  if (msg.type === 'create') {
    log('Gonna create that website yo')

    if (figma.currentPage.selection.length === 0) {
      figma.notify('Please select a frame to publish as a website')
      figma.ui.postMessage({
        type: 'reset-progress'
      })
      return
    }

    const selectedThing: SceneNode = figma.currentPage.selection[0]

    if (!("findAll" in selectedThing)) {
      figma.notify('Please select a _frame_ to publish as a website')
      figma.ui.postMessage({
        type: 'reset-progress'
      })
      return
    }

    // @ts-ignore
    // selectedThing.isRootFrame = true

    // #########################
    // Find every page to upload

    // Goes through to_visit and adds them to to_upload if they are not in visited
    const resolvePages = (visited, to_visit, to_upload) => {
      if (to_visit.length === 0) {
        return to_upload
      }

      // Take last element, modify the to_visit array
      const current_visit = to_visit.pop()

      // Check if we've already checked this node, just in case
      log('current_visit', current_visit)
      if (visited.indexOf(current_visit) !== -1) {
        return to_upload
      }
      const current_visit_node = figma.getNodeById(current_visit)
      if (!('findAll' in current_visit_node)) {
        return to_upload
      }

      const nodes_with_reactions = current_visit_node.findAll((node) => {
        return "reactions" in node
      })
      visited.push(current_visit)
      // if (to_upload.indexOf(current_visit.id) !== -1) { 
      to_upload.push(current_visit)
      // }
      log("nodes_with_reactions")
      log(nodes_with_reactions)

      const pages_to_resolve = nodes_with_reactions.map((n) => {
        if (!("reactions" in n) || !(n.reactions.length > 0)) {
          return
        }
        if (n.reactions[0].action.type !== 'NODE') {
          return
        }
        return n.reactions[0].action.destinationId
      }).filter(n => !!n).filter(id => visited.indexOf(id) === -1)

      log('pages_to_resolve')
      log(pages_to_resolve)

      pages_to_resolve.forEach((n) => {
        if (visited.indexOf(n) === -1) {
          to_visit.push(n)
        }
      })

      log("resolvePages return")
      log(visited, to_visit, to_upload)
      return resolvePages(visited, to_visit, to_upload)
    }


    const pages_to_upload = resolvePages([], [selectedThing.id], [])
    log("pages_to_upload")
    log(pages_to_upload)

    pages_to_upload.forEach(() => {
      figma.ui.postMessage({
        type: 'add-progress-total'
      })
    })

    let website_id = figma.currentPage.getPluginData('parameter_website_id')
    log(`[code:create-or-load-website:cached-website]`, figma.currentPage.getPluginData('parameter_website_id'))
    log(`[code:create-or-load-website:cached-website]`, website_id)
    log(website_id)
    // TODO websites are not being updated properly, or I'm not querying it correct, big shocker
    const startpage = selectedThing.name
    log('figma.currentPage', figma.currentPage)
    const figma_page_name = figma.currentPage.name
    // enable caching of website when it's updating properly
    if (website_id === undefined || website_id === "" || website_id === null || website_id === "null") {
    // if (true) {

      const web_res: any = await postAndWaitForReply('create-website-resource', {
        name: figma_page_name,
        startpage
      })
      log('web_res', web_res)
      log(`[code:create-or-load-website:website-resource]`, web_res)
      website_id = web_res.website_id
      figma.currentPage.setPluginData('parameter_website_id', JSON.stringify(website_id))
    } else {
      website_id = JSON.parse(website_id)
    }
    log(`[code:create-or-load-website:cached-website]`, website_id)

    ////////

    log('pages_to_upload', pages_to_upload)
    const pages = await Promise.all(pages_to_upload.map(async (page) => {
      log('starting a page')
    // await Promise.all(pages_to_upload.map(async (page) => {
      // ###########################
      // Find images if there is any
      const page_node = figma.getNodeById(page)
      if (!('findAll' in page_node)) {
        return true
      }

      // Turn vectors into SVGs
      const vectors: Array<any> = page_node.findAll(function (n) {
        log('vector visible?', isNodeVisible(n))
        return n.type === 'VECTOR' // && isNodeVisible(n)
      })
      log('vectors', vectors)
      let vector_svgs = []
      for (const vector of vectors) {
        let bytes = null
        log('vector visible?', vector.visible)
        try {
          bytes = await vector.exportAsync({
            format: "SVG"
          })
        } catch (err) {
          log('something when wrong when trying to export vector', vector.id, vector)
          figma.currentPage.selection = [vector]
          figma.viewport.scrollAndZoomIntoView([vector])
          figma.notify('Export of Vector failed. Try flatting the Vector manually or contact Figma support')
          throw err
        }
        vector_svgs.push({
          id: vector.id,
          bytes
        })
      }
      log('vector svgs', vector_svgs)

      const nodes_with_fills = page_node.findAll((n) => {
        return n.type === 'RECTANGLE' && 'fills' in n
      })
      log("nodes_with_fills")
      log(nodes_with_fills)

      const just_images = nodes_with_fills.reduce((prev, curr) => {
        if (curr.type === 'RECTANGLE' && 'fills' in curr) { 
          return prev.concat(curr.fills)
        }
        return prev
      }, [])

      log("just_images")
      log(just_images)

      const images_to_upload = await Promise.all(just_images.map(async (fill) => {
        // TODO supposedly, TypeScript should help me here and complain if it's
        // possible that `imageHash` is undefined. Alas, it does not! Because of the
        // async/await? Don't know, and don't care, just regret using TypeScript...
        if (fill.imageHash) {
          const image = figma.getImageByHash(fill.imageHash)
          const bytes = await image.getBytesAsync()
          return {
            hash: fill.imageHash,
            bytes
          }
        }
      }))

      log('returning page')
      // return getDocumentString(page_node)
      return {
        page: getDocumentString(page_node),
        images: images_to_upload.filter(p => !!p),
        vectors: vector_svgs
      }
      // const page_res = await postAndWaitForReply('create-page-resource', {
      //   website_id: website_id,
      //   page: getDocumentString(page_node),
      //   images: images_to_upload.filter(p => !!p),
      //   vectors: vector_svgs
      // })
      // log('created one page')
      // log(page_res)
    }))

    log('all pages stringified!')
    log(pages)

    figma.ui.postMessage({
      type: 'update-website',
      startpage: startpage,
      name: figma_page_name,
      website_id: website_id,
      pages: pages
    })
  }
};

figma.showUI(__html__, {
  height: 170,
  width: 250,
});

