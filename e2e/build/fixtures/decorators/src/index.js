function propertyDecorator() {
  global.aaa = 'hello';
}

function methodDecorator() {
  global.bbb = 'world';
}

class C {
  @propertyDecorator
  message = 'hello world';

  @methodDecorator
  m() {
    return this.message;
  }
}

global.ccc = new C().m();
