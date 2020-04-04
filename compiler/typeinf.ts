/*
 *   Copyright 2020 Bruno Ribeiro
 *   <https://github.com/brunexgeek/beagle-lang>
 *
 *   Licensed under the Apache License, Version 2.0 (the "License");
 *   you may not use this file except in compliance with the License.
 *   You may obtain a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 *   Unless required by applicable law or agreed to in writing, software
 *   distributed under the License is distributed on an "AS IS" BASIS,
 *   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *   See the License for the specific language governing permissions and
 *   limitations under the License.
 */

import { CompilationContext, SourceLocation } from './compiler';
import {
    IVisitor,
    Name,
	StringLiteral,
	NumberLiteral,
	BoolLiteral,
	NameLiteral,
	Group,
	NullLiteral,
	LogicalExpr,
	BinaryExpr,
	AssignExpr,
	UnaryExpr,
	CallExpr,
	ArrayExpr,
	ArrayAccessExpr,
	FieldExpr,
	NewExpr,
	Accessor,
	BlockStmt,
	ReturnStmt,
	NamespaceStmt,
	TypeRef,
	CaseStmt,
	SwitchStmt,
	IfStmt,
	ForOfStmt,
	DoWhileStmt,
	WhileStmt,
	Parameter,
	ExpandExpr,
	FunctionStmt,
	ClassStmt,
	ExprStmt,
	BreakStmt,
	ContinueStmt,
	VariableStmt,
	TryCatchStmt,
	ThrowStmt,
    Unit,
    ImportStmt,
    IStmt,
    TypeCastExpr,
    PropertyStmt,
    NameAndGenerics,
    ForStmt} from './types';
import { TokenType } from './tokenizer';
import { realpath, dirname, Logger } from './utils';


/*
class SignatureMap
{
    keys : string[] = [];
    values : string[] = [];

    constructor()
    {
        this.insert('number', 'N');
        this.insert('string', 'S');
        this.insert('boolean', 'B');
    }

    find( key : string ) : string
    {
        let idx = this.keys.indexOf(key);
        if (idx == -1) return 'L' + key + ';';
        return this.values[idx];
    }

    insert( key : string, value : string )
    {
        this.keys.push(key);
        this.values.push(value);
    }
}

export class TypeUID
{
    signatures : SignatureMap = new SignatureMap();
    ctx : CompilationContext;

    constructor( ctx : CompilationContext )
    {
        this.ctx = ctx;
    }

    process( unit : Unit )
    {
        this.processStmts(unit.stmts);
    }

    processStmts( stmts : IStmt[] )
    {
        for (let stmt of stmts)
        {
            if (stmt instanceof NamespaceStmt)
                this.processStmts(stmt.stmts);
            else
            if (stmt instanceof ClassStmt)
                this.processClass(stmt);
            else
            if (stmt instanceof FunctionStmt)
                this.processFunction(stmt);
            else
            if (stmt instanceof VariableStmt)
                this.processVariable(stmt);
        }
    }

    typeUid( target : TypeRef ) : string
    {
        return target.name.lexemes[ target.name.lexemes.length - 1 ];
    }

    typeSignature( target : TypeRef ) : string
    {
        if (!target) return '';

        let result = '';
        let i = 0;
        while (i++ < target.dims) result += '[';
        if (!target.uid || target.uid.length == 0)
            target.uid = this.typeUid(target);
        result += this.signatures.find(target.uid);
        return result;
    }

    processFunction(target: FunctionStmt): string {
        let sign = '';

        sign += target.name.lexemes[0] + ':';
        if (target.property) sign += '@';
        sign += '(';
        for (let par of target.params)
        {
            if (par.vararg) sign += '.';
            sign += this.typeSignature(par.type);
        }
        sign += ')';
        if (target.type)
            sign += this.typeSignature(target.type);
        else
            sign += 'V';
        target.uid = sign;
        console.error('---- signature is ' + sign);
    }

    processClass(target: ClassStmt): string {
        let content = '';
        for (let f of target.stmts)
        {
            if (f instanceof FunctionStmt)
                this.processFunction(f);
            else
            if (f instanceof VariableStmt)
                this.processVariable(f);
            else
                continue;
            content += f.uid;
        }

        target.uid = target.name.lexemes[0] + '_' + this.sha256(content);
        console.error('---- signature is ' + target.uid);
    }

    processVariable(target: VariableStmt): string
    {
        let sign = target.name.lexemes[0] + ':';
        sign += this.typeSignature(target.type);
        target.uid = sign;
        console.error('---- signature is ' + sign);
    }

    sha256( value : string ) : string
    {
        return require('crypto').createHash("sha256").update(value).digest('hex');
    }
}*/

class ScopeEntry
{
    target : IStmt;
    type : TypeRef;
}

class Scope
{
    private entries : Map<string, ScopeEntry> = new Map();

    constructor()
    {
        //this.insert('result', new NullLiteral(), new TypeRef(new Name(['result'], null), null, 0));
        //if (this.entries.find('result')) console.error('Got it!');
    }

    insert( name : string, target : IStmt, type : TypeRef )
    {
        console.error(`Adding '${name}' -> ${target.className()}`);
        let item = new ScopeEntry();
        item.target = target;
        item.type = type;
        this.entries.set(name, item);
    }

    find( name : string ) : ScopeEntry
    {
        return this.entries.get(name);
    }
}

export class SemanticError extends Error
{
    public location : SourceLocation;

    constructor( message : string, location : SourceLocation = null )
    {
        if (location) message += ' at ' + location.toString();
        super(message);
        this.location = location;
    }
}

export function findSymbol( unit : Unit, name : string ) : IStmt
{
    let stmt = <IStmt> unit.variables.get(name);
    if (stmt) return stmt;
    stmt = <IStmt> unit.functions.get(name);
    if (stmt) return stmt;
    stmt = <IStmt> unit.types.get(name);
    if (stmt) return stmt;
    return null;
}

export class TypeInference implements IVisitor<TypeRef>
{
    ctx : CompilationContext;
    stack : Scope[] = [new Scope()];
    imports : Map<string, IStmt> = new Map();
    unit : Unit = null;
    types : string[] = [];

    constructor( ctx : CompilationContext )
    {
        this.ctx = ctx;
    }

    visitTypeCastExpr(target: TypeCastExpr): TypeRef
    {
        throw new Error("Method not implemented.");
    }

    visitPropertyStmt(target: PropertyStmt): TypeRef
    {
        let result : TypeRef = null;
        if (target.type)
        {
            result = target.type.accept(this);
        }
        if (target.init)
        {
            let itype = target.init.accept(this);
            if (result && !this.checkCompatibleTypes(result, itype))
                this.error(target.location, `Initialize incompatible with variable type (${result} and ${itype}`);

            if (!result) result = itype;
        }
        target.type = result;

        this.top().insert(target.name.toString(), target, result);
        return result;
    }

    processImports()
    {
        let dir = dirname(this.unit.fileName);
        for (let imp of this.unit.imports)
        {
            let source = realpath(dir + imp.source + '.ts');
            let unit = this.ctx.units.get(source);
            for (let name of imp.names)
            {
                if (unit)
                {
                    let stmt = findSymbol(unit, name.qualified);
                    if (!stmt) this.error(name.location, `Unable to find symbol ${name.qualified}`);
                    this.imports.set(name.qualified, stmt);
                }
                else
                {
                    this.error(name.location, `Unable to find symbol ${name.qualified}`);
                }
            }
        }
    }

    visitNameAndGenerics(target: NameAndGenerics): TypeRef {
        return null;
    }

    visitForStmt(target: ForStmt): TypeRef {
        return null;
    }

    push()
    {
        this.stack.push(new Scope());
        console.error('push scope');
    }

    pop()
    {
        if (this.stack.length <= 1)
            throw new SemanticError('Type inference stack underflow');
        this.stack.pop();
        console.error('pop scope');
    }

    top() : Scope
    {
        return this.stack[ this.stack.length - 1 ];
    }

    error( location : SourceLocation, message : string ) : SemanticError
    {
        let result = new SemanticError(message, location);
        this.ctx.listener.onError(location, result);
        return result;
    }

    find( name : string ) : ScopeEntry
    {
        if (this.stack.length == 0) return null;

        let i = this.stack.length - 1;
        let entry : ScopeEntry = null;
        while (i >= 0)
        {
            entry = this.stack[i].find(name);
            if (entry != null) break;
            --i;
        }
        if (entry)
            console.error(`Found '${name}' (${this.stack.length} scopes)`);
        else
            console.error(`Missing '${name}'  (${this.stack.length} scopes)`);
        return entry;
    }

    visitName(target: Name) : TypeRef {
        return null;
    }

    visitStringLiteral(target: StringLiteral) : TypeRef
    {
        return TypeRef.STRING;
    }

    visitNumberLiteral(target: NumberLiteral) : TypeRef
    {
        return TypeRef.NUMBER;
    }

    visitBoolLiteral(target: BoolLiteral) : TypeRef
    {
        return TypeRef.BOOLEAN;
    }

    visitNameLiteral(target: NameLiteral) : TypeRef
    {
        let entry = this.find(target.value);
        if (entry == null)
            this.error(target.location, `Cannot find name '${target.value}'`);
        else
            return entry.type;
    }

    visitGroup(target: Group) : TypeRef
    {
        return target.expr.accept(this);
    }

    visitNullLiteral(target: NullLiteral) : TypeRef
    {
        return TypeRef.NULL;
    }

    visitLogicalExpr(target: LogicalExpr) : TypeRef
    {
        let left = target.left.accept(this);
        let right = target.right.accept(this);
        if (!this.checkCompatibleTypes(left, right))
            throw this.error(target.location, 'Incompatible types for logical operator');
        return TypeRef.BOOLEAN;
    }

    visitBinaryExpr(target: BinaryExpr) : TypeRef
    {
        let left = target.left.accept(this);
        let right = target.right.accept(this);
        if (!this.checkCompatibleTypes(left, right))
            this.error(target.location, `Incompatible types for binary operator (${left} and ${right})`);
        if (left == TypeRef.STRING && target.oper != TokenType.PLUS)
            this.error(target.location, `The operator ${target.oper.lexeme} cannot be used on strings`);
        return left;
    }

    visitAssignExpr(target: AssignExpr) : TypeRef
    {
        let left = target.left.accept(this);
        let right = target.right.accept(this);
        if (left != right)
            throw this.error(target.location, 'Incompatible types for logical operator');
        if (left == TypeRef.STRING && target.oper != TokenType.PLUS_EQUAL && target.oper != TokenType.EQUAL)
            throw this.error(target.location, `The operator ${target.oper.lexeme} cannot be used on strings`);
        return left;
    }

    visitUnaryExpr(target: UnaryExpr) : TypeRef
    {
        return target.expr.accept(this);
    }

    visitCallExpr(target: CallExpr) : TypeRef
    {
        return target.callee.accept(this);
    }

    visitArrayExpr(target: ArrayExpr) : TypeRef
    {
        if (target.values.length > 0)
            return target.values[0].accept(this);
        return TypeRef.ANY;
    }

    visitArrayAccessExpr(target: ArrayAccessExpr) : TypeRef
    {
        return target.callee.accept(this);
    }

    visitFieldExpr(target: FieldExpr) : TypeRef
    {
        let type = target.callee.accept(this);
        return null;
    }

    visitNewExpr(target: NewExpr) : TypeRef
    {
        return target.type = target.type.accept(this);
    }

    visitAccessor(target: Accessor) : TypeRef
    {
        return null;
    }

    visitBlockStmt(target: BlockStmt) : TypeRef {
        this.push();

        for (let stmt of target.stmts)
            stmt.accept(this);

        this.pop();
        return null;
    }

    visitReturnStmt(target: ReturnStmt) : TypeRef
    {
        return target.expr.accept(this);
    }

    visitNamespaceStmt(target: NamespaceStmt) : TypeRef
    {
        this.push();
        for (let stmt of target.stmts) stmt.accept(this);
        this.pop();
        return null;
    }

    resolveType( type : TypeRef ) : TypeRef
    {
        let name = type.name.toString();

        if (name == 'string' || name == 'number' || name == 'boolean' || name == 'void') return type;
        if (this.types.indexOf(name) >= 0) return type;
        if (this.imports.get(name)) return type;
        throw this.error(type.location, `Unknown type '${name}'`);
    }

    visitTypeRef(target: TypeRef) : TypeRef
    {
        return this.resolveType(target);
    }

    visitCaseStmt(target: CaseStmt) : TypeRef
    {
        target.expr.accept(this);
        for (let stmt of target.stmts) stmt.accept(this);

        return null;
    }

    visitSwitchStmt(target: SwitchStmt) : TypeRef
    {
        target.expr.accept(this);
        for (let stmt of target.cases) stmt.accept(this);
        return null;
    }

    visitIfStmt(target: IfStmt) : TypeRef
    {
        target.condition.accept(this);
        if (target.thenSide) target.thenSide.accept(this);
        if (target.elseSide) target.elseSide.accept(this);

        return null;
    }

    visitForOfStmt(target: ForOfStmt) : TypeRef
    {
        target.expr.accept(this);
        target.stmt.accept(this);
        return null;
    }

    visitDoWhileStmt(target: DoWhileStmt) : TypeRef
    {
        target.condition.accept(this);
        target.stmt.accept(this);
        return null;
    }

    visitWhileStmt(target: WhileStmt) : TypeRef
    {
        target.condition.accept(this);
        target.stmt.accept(this);
        return null;
    }
    visitParameter(target: Parameter) : TypeRef
    {
        return null;
    }

    visitExpandExpr(target: ExpandExpr) : TypeRef
    {
        return null;
    }

    visitFunctionStmt(target: FunctionStmt) : TypeRef
    {
        if (target.isGeneric) return null;
        this.push();

        if (!target.type)
            target.type = TypeRef.VOID;
        else
            target.type.accept(this);

        for (let param of target.params)
        {
            param.type.accept(this);
            this.top().insert(param.name.toString(), param, param.type);
        }

        if (target.body) target.body.accept(this);

        this.pop();

        return target.type;
    }

    visitClassStmt(target: ClassStmt) : TypeRef
    {
        this.push();

        for (let stmt of target.stmts)
            stmt.accept(this);

        this.pop();
        return null;
    }

    visitExprStmt(target: ExprStmt) : TypeRef
    {
        return target.expr.accept(this);
    }

    visitBreakStmt(target: BreakStmt) : TypeRef {
        return null;
    }

    visitContinueStmt(target: ContinueStmt) : TypeRef
    {
        return null;
    }

    visitImportStmt(target: ImportStmt) : TypeRef
    {
        return null;
    }

    checkCompatibleTypes( type1 : TypeRef, type2 : TypeRef ) : boolean
    {
        if (type1 == TypeRef.BOOLEAN || type1 == TypeRef.NUMBER)
            return type2.toString() == type1.toString();
        if (type1 == TypeRef.STRING || type2 == TypeRef.NULL)
            return true;
        if (type1 == TypeRef.ANY || type2 == TypeRef.ANY)
            return true;
        return type2.toString() == type1.toString();
    }

    visitVariableStmt(target: VariableStmt) : TypeRef
    {
        let result : TypeRef = null;
        if (target.type)
        {
            result = target.type.accept(this);
        }
        if (target.init)
        {
            let itype = target.init.accept(this);
            if (result && !this.checkCompatibleTypes(result, itype))
                this.error(target.location, `Initialize incompatible with variable type (${result} and ${itype}`);

            if (!result) result = itype;
        }
        target.type = result;

        this.top().insert(target.name.toString(), target, result);
        return result;
    }

    visitTryCatchStmt(target: TryCatchStmt) : TypeRef
    {
        target.block.accept(this);
        target.cblock.accept(this);
        target.fblock.accept(this);
        return null;
    }

    visitThrowStmt(target: ThrowStmt) : TypeRef
    {
        target.expr.accept(this);
        return null;
    }

    visitUnit(target: Unit) : TypeRef
    {
        try {
            this.unit = target;
            this.processImports();
            for (let stmt of target.stmts) stmt.accept(this);
        } catch (error)
        {
            this.ctx.listener.onError(error.location, error);
        }

        return null;
    }

}