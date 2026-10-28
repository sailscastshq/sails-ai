class Adapter {
 async initialize(config) { this.config=config; this.calls=[] }
 async chat(input) { return input }
 async *stream(input) { yield {text:input.messages[0].content,done:true} }
 async teardown() { Adapter.closed=(Adapter.closed || 0)+1 }
}
module.exports=Adapter
