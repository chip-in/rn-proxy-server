import webClient from 'request'
import {
  ResourceNode,
  ServiceEngine,
  Proxy,
  Subscriber,
} from '@chip-in/resource-node'
import http from 'http'
import https from 'https'
import url from 'url'

process.on('unhandledRejection', console.dir)

if (process.argv.length !== 4) {
  console.log(
    'Usage: npm start -- ' +
      "<core_node_url(e.g. 'http://test-core.chip-in.net')> " +
      "<node_class(e.g. 'rn-proxy-server')> "
  )
  process.exit(0)
}
var coreNodeUrl = process.argv[2]
var nodeClass = process.argv[3]

var jwtToken = process.env.ACCESS_TOKEN
var jwtRefreshPath = process.env.TOKEN_UPDATE_PATH

class SignalHandler {
  constructor(node) {
    this.targets = ['SIGINT', 'SIGTERM']
    this.node = node
    this._init()
  }
  _init() {
    this.targets.map((s) =>
      process.on(s, () => {
        this.node.logger.info('Shutdown process start.')
        this._execShutdown()
      })
    )
  }
  _execShutdown() {
    this.node.stop().then(() => {
      this.node.logger.info('Shutdown process has completed.')
      setImmediate(function () {
        process.exit(0)
      })
    })
  }
}
class OneToOneProxyServer extends ServiceEngine {
  constructor(option) {
    super(option)
    this.path = option.path
    this.mode = option.mode
    this.forwardPath = option.forwardPath
    var agentOptions = {
      keepAlive: option.keepAlive != null ? option.keepAlive : true,
      keepAliveMsecs: option.keepAliveMsecs || 10000,
      maxSockets: option.maxSockets || 32,
      maxFreeSockets: option.maxFreeSockets || 8,
      timeout: option.timeout || 60000,
    }
    this.agent = this.agent =
      this.forwardPath.indexOf('https://') == 0
        ? new https.Agent(agentOptions)
        : new http.Agent(agentOptions)
  }

  start(node) {
    return Promise.resolve()
      .then(() =>
        node.mount(
          this.path,
          this.mode,
          new ReverseProxy(node, this.path, this.forwardPath, this.agent)
        )
      )
      .then((ret) => (this.mountId = ret))
      .then(() =>
        node.logger.info(
          "rn-proxy-server started. Try to access '" +
            coreNodeUrl +
            this.path +
            "'"
        )
      )
  }

  stop(node) {
    return Promise.resolve()
  }
}

class ReverseProxy extends Proxy {
  constructor(rnode, path, forwardPath, agent) {
    super()
    this.rnode = rnode
    if (path == null) {
      throw new Error('Path is empty')
    }
    this.basePath = path[path.length - 1] !== '/' ? path + '/' : path
    this.forwardPath =
      forwardPath[forwardPath.length - 1] === '/'
        ? forwardPath.substr(0, forwardPath.length - 1)
        : forwardPath
    this.agent = agent
  }
  onReceive(req, res) {
    return Promise.resolve().then(() => {
      if (req.url.indexOf(this.basePath) !== 0) {
        this.rnode.logger.error('Unexpected path is detected:' + req.url)
        return Promise.reject(
          new Error('Unexpected path is detected:' + req.url)
        )
      }
      return new Promise((resolve, reject) => {
        var forwardUrl = url.parse(
          this.forwardPath + String(req.url).substr(this.basePath.length - 1)
        )

        var option = {
          host: forwardUrl.hostname,
          port: forwardUrl.port,
          path: forwardUrl.path,
          method: req.method || 'GET',
          headers: req.headers,
        }
        if (option.headers) delete option.headers.host
        // if (option.headers) {
        //   delete option.headers['content-length']
        //   // Body has already been decoded by core-node.
        //   delete option.headers['content-encoding']
        // }
        let responseCode
        const proxyRequest = http
          .request(option)
          .on('error', (e) => {
            console.error(e)
            responseCode = 502
            res.statusCode = 502
            res.end()
            resolve(res)
          })

          .on('timeout', () => {
            responseCode = 504
            res.statusCode = 504
            res.end()
            resolve(res)
          })
          .on('response', (proxyRes) => {
            responseCode = proxyRes.statusCode
            res.writeHead(proxyRes.statusCode, proxyRes.headers)
            let data = ''
            proxyRes
              .on('data', function (chunk) {
                data += chunk
              })
              .on('end', function () {
                res.end(data)
                resolve(res)
              })
              .on('error', function () {
                res.writeStatus(proxyRes.statusCode)
                res.end()
                resolve(res)
              })
          })
          .on('close', () => {
            console.log(
              [
                new Date().toISOString(),
                req.ip,
                req.method,
                req.url,
                '=>',
                forwardUrl.path,
                responseCode ?? '',
              ].join(' ')
            )
          })
        req.pipe(proxyRequest)
      })
    })
  }
}
var rnode = new ResourceNode(coreNodeUrl, nodeClass)
rnode.registerServiceClasses({
  OneToOneProxyServer,
})
if (jwtToken) {
  rnode.setJWTAuthorization(jwtToken, jwtRefreshPath)
}
rnode
  .start()
  .then(() => {
    new SignalHandler(rnode)
    rnode.logger.info('Succeeded to start resource-node')
  })
  .catch((e) => {
    rnode.logger.info('Failed to start resource-node', e)
    rnode.stop()
  })
