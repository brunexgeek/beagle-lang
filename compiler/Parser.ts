/// <reference path="tree.ts" />
/// <reference path="Scanner.ts" />
/// <reference path="context.ts" />


namespace beagle.compiler {


/**
 * Ring array of tokens used to get tokens from input data
 * and to perform lookahead searchs.
 */
export class TokenArray
{
	private scanner : Scanner;
	private buffer : Token[];
	private current : number;
	private size : number;

	public constructor( scanner : Scanner, size : number = 5)
	{
		this.current = 0;
		this.size = Math.max(5, size);
		this.buffer = [];
		this.buffer.length = this.size;
		this.scanner = scanner;

		// fill the ring array with tokens
		for (let i = 0; i < size; ++i)
			if ((this.buffer[i] = scanner.readToken()) == null)
				break;
	}

	/**
	 * Return the current token and advances the cursor.
	 *
	 * @return
	 */
	public read() : Token
	{
		if (this.buffer[this.current] != null)
		{
			let value = this.buffer[this.current];
			this.buffer[this.current] = this.scanner.readToken();
			this.current = (this.current + 1) % this.size;
			return value;
		}
		return null;
	}

	public peek() : Token
	{
		return this.peekAt(0);
	}

	public peekAt( index : number ) : Token
	{
		let pos = (this.current + index) % this.size;
		return this.buffer[pos];
	}

	public peekType() : TokenType
	{
		return this.peekTypeAt(0);
	}

	public peekTypeAt( index : number ) : TokenType
	{
		let result = this.peekAt(index);
		if (result == null)
			return null;
		else
			return result.type;
	}

	/**
	 * Check if the next tokens in the input sequence corresponds to the given ones.
	 *
	 * If isRequired is true and the lookahead fails, this function send a
	 * compilation error to the current listener before returns.
	 *
	 * @param types
	 * @return
	 */
	public lookahead( isRequired : boolean, ...types : TokenType[] ) : boolean
	{
		if (types.length == 0)
			return false;
		if (types.length >= this.size)
			return false;

		let first = this.buffer[this.current];
		let count = types.length;

		for (let i = 0; i < count; ++i)
		{
			let pos = (this.current + i) % this.size;
			let entry = this.buffer[pos];
			if (i != 0 && entry == first)
				return false;

			if (entry == null || entry.type != types[i])
				return false;
		}
		return true;
	}

	public discard( count : number = 1 )
	{
        for (let i = 0; i < count; ++i) this.read();
	}

	public discardIf( type : TokenType ) : boolean
	{
		let current = this.peek();
		if (current != null && current.type == type)
		{
			this.read();
			return true;
		}
		else
		{
			this.scanner.context.listener.onError(null, "Syntax error, expected '" + type + "'");
			return false;
		}
	}
}



export class Parser
{
	private fileName : string;
	private tokens : TokenArray;
	private context : CompilationContext;

	public constructor( context : CompilationContext, scanner : Scanner )
	{
		this.fileName = "";
		this.tokens = new TokenArray(scanner, 16);
		this.context = context;
	}

	private expectedOneOf( ...types : TokenType[] ) : boolean
	{
		for (let type of types)
		{
			if (this.tokens.peek().type == type) return true;
		}

		this.context.throwExpected(this.tokens.peek(), types);
		return false;
	}

	/**
	 * Parse a compilation unit.
	 *
	 *   Unit: Package? Import* Type+
	 *
	 * @return
	 */
	public parse() : tree.CompilationUnit
	{
		let current = this.tokens.peek();
		let pack = null;

		//if (this.tokens.peekType() == TokenType.TOK_PACKAGE)
		//	pack = this.parsePackage();

		let unit = new tree.CompilationUnit("builtin");

		/*current = this.tokens.peek();
		while (current != null && current.type == TokenType.TOK_IMPORT)
		{
			let imp = this.parseImport();
			if (imp == null) break;
            unit.imports.push(imp);
			current = this.tokens.peek();
		}*/

		this.parseTopLevelStatements(unit.statements);

		return unit;
	}

	parseName( isQualified : boolean = true ) : tree.Name
	{
		if (!this.expectedOneOf(TokenType.TOK_NAME))
			return null;

		let location = this.tokens.peek().location;
		let result = new tree.Name(this.tokens.peek().value);
		this.tokens.discard();

		while (isQualified)
		{
			if (!this.tokens.lookahead(false, TokenType.TOK_DOT, TokenType.TOK_NAME))
				break;
				result.appendName(this.tokens.peekAt(1).value);
			this.tokens.discard(2);
		}

		result.location = location;
		return result;
	}

	parseImport() : tree.TypeImport
	{
		if (this.tokens.peekType() == TokenType.TOK_IMPORT)
		{
			this.tokens.discard();
            let alias = null;
			let qualifiedName = this.parseName();
			if (qualifiedName == null) return null;

            let isWildcard = false;
			if (this.tokens.lookahead(false, TokenType.TOK_DOT, TokenType.TOK_MUL))
			{
				this.tokens.discard(2);
				isWildcard = true;
			}
			else
			{
				if (this.tokens.peekType() == TokenType.TOK_AS)
				{
					this.tokens.discard();
					alias = this.parseName();
					if (alias == null) return null;
				}
			}
            if (this.tokens.peekType() != TokenType.TOK_SEMICOLON) return null;
            this.tokens.discard(1);

            return new tree.TypeImport(qualifiedName, isWildcard, alias);
		}
		return null;
	}

	private parseNamespace( annots : tree.Annotation[] ) : tree.Namespace
    {
		// TOK_NAMESPACE
		this.tokens.discard();
		// TOK_NAME
		let name = this.parseName();
		if (name == null) return null;
		// TOK_LEFT_BRACE
		if (!this.expectedOneOf(TokenType.TOK_LEFT_BRACE)) return null;
		this.tokens.discard();

		let ns = new tree.Namespace(annots, name);
		this.parseTopLevelStatements(ns.statements);

		// TOK_RIGHT_BRACE
		if (!this.expectedOneOf(TokenType.TOK_RIGHT_BRACE)) return null;
		this.tokens.discard();

		return ns;
	}

    private parseTopLevelStatements( stmts : tree.IStatement[] )
    {
		while (true)
		{
			let tt = this.tokens.peekType();
			let annots = null;

			// parse annotations
			if (tt == TokenType.TOK_AT)
			{
				if (this.tokens.peek().type == TokenType.TOK_AT)
				annots = this.parseAnnotations();
				tt = this.tokens.peekType();
			}

			// parse imports
			if (tt == TokenType.TOK_IMPORT)
			{
				let temp = this.parseImport();
				if (temp == null) return;
				stmts.push(temp);
			}
			else
			// parse namespaces
			if (tt == TokenType.TOK_NAMESPACE)
			{
				let temp = this.parseNamespace(annots);
				if (temp == null) return;
				stmts.push(temp);
			}
			else
			// parse variables
			if (tt == TokenType.TOK_VAR)
			{
				let storage = this.parseVariableOrConstant(annots, true);
				if (storage == null) return;
				stmts.push(storage);
			}
			else
			// parse structures
			if (tt == TokenType.TOK_CLASS)
			{
				let struct = this.parseTypeDeclaration(annots);
				if (struct == null) return;
				stmts.push(struct);
			}
			else
			// parse functions
			if (tt == TokenType.TOK_FUNCTION)
			{
				let func = this.parseFunction(annots);
				if (func == null) return;
				stmts.push(func);
			}
			else
			{
				//this.context.listener.onError(this.tokens.peek().location, "Unrecognized statement " + tt.token);
				break;
			}
		}
    }

    private parseAnnotations() : tree.Annotation[]
    {
        let decors = [];

        while (this.tokens.peekType() == TokenType.TOK_AT)
        {
            this.tokens.discard();
            let name = this.parseName();

            decors.push( new tree.Annotation(name) );
        }

        return decors;
	}

	private parseBlock() : tree.BlockStmt
	{
		let stmts : tree.IExpression[] = [];

		if (this.tokens.peekType() == TokenType.TOK_LEFT_BRACE)
		{
			this.tokens.discard();
			let tt = this.tokens.peekType();

			while (tt != TokenType.TOK_RIGHT_BRACE && tt != TokenType.TOK_EOF)
			{
				let current = this.parseStatement();
				if (current == null) return null;

				// discard ';'
				if (!this.expectedOneOf(TokenType.TOK_SEMICOLON)) return null;
				this.tokens.discard();

				stmts.push(current);
				tt = this.tokens.peekType();
			}
			if (!this.expectedOneOf(TokenType.TOK_RIGHT_BRACE)) return null;
			this.tokens.discard();
		}
		else
		{
			let current = this.parseStatement();
			if (current == null) return null;

			// discard ';'
			if (!this.expectedOneOf(TokenType.TOK_SEMICOLON)) return null;
			this.tokens.discard();

			stmts.push( this.parseStatement() );
		}

		return new tree.BlockStmt(stmts);
	}

	private parseStatement() : tree.IStatement
	{
		switch (this.tokens.peekType())
		{
			case TokenType.TOK_RETURN:
				return this.parseReturnStmt();
			case TokenType.TOK_IF:
				return this.parseIfThenElseStmt();
			case TokenType.TOK_VAR:
			case TokenType.TOK_CONST:
				return <tree.IStatement> this.parseVariableOrConstant(null);
			case TokenType.TOK_FOR:
				return <tree.IStatement> this.parseForEach();
			default:
				break;
		}

		let expr = this.parseExpression();
		if (expr == null) return null;
		//if (!this.expectedOneOf(TokenType.TOK_SEMICOLON)) return null;
		return new tree.ExpressionStmt(expr);
	}

/**
	 *
	 * IfThenElse: "if" Expression "then" BlockOrStatement ( "else" BlockOrStatement )?
	 *
	 * @return
	 */
	private parseIfThenElseStmt() : tree.IfThenElseStmt
	{
		if (!this.expectedOneOf(TokenType.TOK_IF, TokenType.TOK_ELIF)) return null;
		this.tokens.discard();

		let condition = this.parseExpression();

		if (!this.expectedOneOf(TokenType.TOK_THEN)) return null;
		this.tokens.discard();

		let thenSide : tree.IStatement = null;
		let elseSide : tree.IStatement = null;

		// required 'then' block
		thenSide = this.parseBlock();
		if (thenSide == null) return null;

		// optional 'elif' block
		if (this.tokens.peekType() == TokenType.TOK_ELIF)
		{
			elseSide = this.parseIfThenElseStmt();
			if (elseSide == null) return null;
		}
		else
		// optional 'else' block
		if (this.tokens.peekType() == TokenType.TOK_ELSE)
		{
			this.tokens.discard();
			elseSide = this.parseBlock();
			if (elseSide == null) return null;
		}

		return new tree.IfThenElseStmt(condition, thenSide, elseSide);
	}

	private parseForEach() : tree.ForEachStmt
	{
		// 'for' keyword
		if (!this.expectedOneOf(TokenType.TOK_FOR)) return null;
		this.tokens.discard();
		// variable
		let storage = new tree.StorageDeclaration(null, this.parseName(), null, false, null);
		// 'in' keyword
		if (!this.expectedOneOf(TokenType.TOK_IN)) return null;
		this.tokens.discard();
		// expression
		let expr = this.parseExpression();
		// statements
		let block = this.parseBlock();

		return new tree.ForEachStmt(storage, expr, block);
	}

	/**
	 * Return: "return" Expression
	 *
	 * @return
	 */
	private parseReturnStmt() : tree.IStatement
	{
		// 'return' keyword
		if (!this.expectedOneOf(TokenType.TOK_RETURN)) return null;
		let location = this.tokens.peek().location;
		this.tokens.discard();
		// expression
		let expr = this.parseExpression();

		return new tree.ReturnStmt(expr);
	}

	private parseTypeDeclaration(annots : tree.Annotation[]) : tree.TypeDeclaration
	{
		this.tokens.discard();

		if (!this.expectedOneOf(TokenType.TOK_NAME)) return null;
		let output = new tree.TypeDeclaration(annots, this.parseName());

		/*if (this.tokens.peekType() == TokenType.TOK_COLON)
		{
			this.tokens.discard();
			output.parents.push( new tree.TypeReference(this.parseName(false)) );
		}*/

		if (this.tokens.peekType() == TokenType.TOK_LEFT_BRACE)
		{
			this.tokens.discard();

			// parse every type member
			while (this.tokens.peekType() != TokenType.TOK_RIGHT_BRACE)
			{
				let annots = this.parseAnnotations();
				let access = this.parseAccessMode();
				let name = this.parseName();

				// variable or constant
				if (this.tokens.peekType() == TokenType.TOK_COLON || this.tokens.peekType() == TokenType.TOK_ASSIGN)
					output.properties.push( this.parseProperty(annots, access, name) );
				else
				{
					this.context.throwExpected(this.tokens.peek(), [TokenType.TOK_VAR, TokenType.TOK_CONST]);
					break;
				}
			}

			this.tokens.discard();
			return output;
		}

		return null;
	}

	parseAccessMode() : tree.AccessMode
	{
		if (this.tokens.peekType() == TokenType.TOK_PUBLIC)
		{
			this.tokens.discard();
			return tree.AccessMode.PUBLIC;
		}
		else
		if (this.tokens.peekType() == TokenType.TOK_PROTECTED)
		{
			this.tokens.discard();
			return tree.AccessMode.PROTECTED;
		}
		else
		if (this.tokens.peekType() == TokenType.TOK_PRIVATE)
		{
			this.tokens.discard();
			return tree.AccessMode.PRIVATE;
		}

		return tree.AccessMode.PROTECTED;
	}

	private parseFunction( annots : tree.Annotation[] ) : tree.Function
	{
		if (!this.expectedOneOf(TokenType.TOK_FUNCTION)) return null;
		this.tokens.discard();

		let type : tree.TypeReference = null;
		// name
		let name = this.parseName();
		// parameters
		if (!this.expectedOneOf(TokenType.TOK_LEFT_PAR)) return null;
		let params = this.parseFormalParameters();
		// return type
		if (this.tokens.peekType() == TokenType.TOK_COLON)
		{
			this.tokens.discard(1);
			type = new tree.TypeReference( this.parseName() );
			//type.location = type.name.location;
		}
		// body
		let block = this.parseBlock();

		let func = new tree.Function(annots, name, type, params, block);

		return func;
	}

	private parseFormalParameters() : tree.FormalParameter[]
	{
		if (this.tokens.peekType() != TokenType.TOK_LEFT_PAR) return null;
		this.tokens.discard();

		let output : tree.FormalParameter[] = [];
		let typeName : tree.Name, name : tree.Name;

		while (this.tokens.peekType() != TokenType.TOK_RIGHT_PAR)
		{
			if (this.tokens.peekType() == TokenType.TOK_COMA)
			{
				this.tokens.discard();
				continue;
			}

			name = this.parseName();
			if (!this.expectedOneOf(TokenType.TOK_COLON)) return null;
			this.tokens.discard();
			typeName = this.parseName();
			output.push( new tree.FormalParameter(name, new tree.TypeReference(typeName)) );
		}

		this.tokens.discard(); // )
		return output;
	}

	private parseProperty( annots : tree.Annotation[], access : tree.AccessMode, name : tree.Name ) : tree.Property
	{
		let location = name.location;
		let type : tree.TypeReference;
		let initializer : tree.IExpression = null;

		// check whether we have type annotation
		if (this.tokens.peekType() == TokenType.TOK_COLON)
		{
			this.tokens.discard(1);
			type = new tree.TypeReference( this.parseName() );
		}
		// check whether we have an initializer expression
		if (this.tokens.peekType() == TokenType.TOK_ASSIGN)
		{
			this.tokens.discard(); // =
			initializer = this.parseExpression();
		}

		// discard the semicolon
		if (!this.expectedOneOf(TokenType.TOK_SEMICOLON)) return null;
		this.tokens.discard();

		let result = new tree.Property(annots, access, name, type, initializer);
		return result;
	}


	private parseVariableOrConstant( annots : tree.Annotation[], comma : boolean = false ) : tree.StorageDeclaration
	{
		// get 'var' or 'const' keyword
		let kind = this.tokens.peekType();
		this.tokens.discard();

		let name = this.parseName(false);
		let location = name.location;
		let type : tree.TypeReference;
		let initializer : tree.IExpression = null;

		// check whether we have type annotation
		if (this.tokens.peekType() == TokenType.TOK_COLON)
		{
			this.tokens.discard(1);
			type = new tree.TypeReference( this.parseName() );
		}

		if (this.tokens.peekType() == TokenType.TOK_ASSIGN)
		{
			this.tokens.discard(); // =
			initializer = this.parseExpression();
		}
		else
		if (kind == TokenType.TOK_CONST)
		{
			this.expectedOneOf(TokenType.TOK_ASSIGN);
			return null;
		}

		// discard the semicolon
		if (comma)
		{
			if (!this.expectedOneOf(TokenType.TOK_SEMICOLON)) return null;
			this.tokens.discard();
		}

		let result : tree.StorageDeclaration;
		result = new tree.StorageDeclaration(annots, name, type, kind == TokenType.TOK_CONST, initializer);
		return result;
	}

	private parseExpression() : tree.IExpression
	{
		return this.parseAssignment();
	}

	private createBinaryExpression(left : tree.IExpression, type : TokenType, right : tree.IExpression) : tree.IExpression
	{
		if (type == null || left == null || right == null)
			return null;
		else
			return new tree.BinaryExpression(left, type, right);
	}

	private parseAssignment() : tree.IExpression
	{
		let left = this.parseDisjunction();
		if (left == null) return null;

		let type : TokenType = null;
		switch(this.tokens.peekType())
		{
			case TokenType.TOK_ASSIGN:       // =
			case TokenType.TOK_PLUS_ASSIGN:  // +=
			case TokenType.TOK_MINUS_ASSIGN: // -=
			case TokenType.TOK_MUL_ASSIGN:   // *=
			case TokenType.TOK_DIV_ASSIGN:   // /=
			case TokenType.TOK_BAND_ASSIGN:  // &=
			case TokenType.TOK_BOR_ASSIGN:   // |=
			case TokenType.TOK_XOR_ASSIGN:   // ^=
			case TokenType.TOK_SHL_ASSIGN:   // <<=
			case TokenType.TOK_SHR_ASSIGN:   // >>=
			case TokenType.TOK_MOD_ASSIGN:   // %=
				type = this.tokens.read().type;
				break;
			default:
				return left;
		}

		return this.createBinaryExpression(left, type, this.parseAssignment());
	}

	/**
	 * Disjunction: Conjunction ( "or" Disjunction )*
	 */
	private parseDisjunction() : tree.IExpression
	{
		let left = this.parseConjunction();
		if (left == null) return null;

		let type : TokenType = null;
		if (this.tokens.peekType() == TokenType.TOK_OR)
			type = this.tokens.read().type;
		else
			return left;

		return this.createBinaryExpression(left, type, this.parseDisjunction());
	}

	/**
	 * Conjunction: EqualityComparison ( "and" Conjunction )*
	 */
	private parseConjunction() : tree.IExpression
	{
		let left = this.parseEquality();
		if (left == null) return null;

		let type : TokenType = null;
		if (this.tokens.peekType() == TokenType.TOK_AND)
			type = this.tokens.read().type;
		else
			return left;

		return this.createBinaryExpression(left, type, this.parseConjunction());
	}

	/**
	 * EqualityComparison: Comparison ( EqualityOperator EqualityComparison )*
	 */
	private parseEquality() : tree.IExpression
	{
		let left = this.parseComparison();
		if (left == null) return null;

		let type : TokenType = null;
		switch(this.tokens.peekType())
		{
			case TokenType.TOK_EQ: // ==
			case TokenType.TOK_NE: // !=
				type = this.tokens.read().type;
				break;
			default:
				return left;
		}

		return this.createBinaryExpression(left, type, this.parseEquality());
	}

	/**
	 * Comparison: NamedInfix ( ComparisonOperator Comparison )*
	 */
	private parseComparison() : tree.IExpression
	{
		let left = this.parseNamedInfix();
		if (left == null) return null;

		let type : TokenType = null;
		switch(this.tokens.peekType())
		{
			case TokenType.TOK_GT: // >
			case TokenType.TOK_GE: // >=
			case TokenType.TOK_LT: // <
			case TokenType.TOK_LE: // <=
				type = this.tokens.read().type;
				break;
			default:
				return left;
		}

		return this.createBinaryExpression(left, type, this.parseComparison());
	}

	/**
	 * NamedInfix
	 *   : AdditiveExpression ( InOperator AdditiveExpression )*
	 *   : AdditiveExpression IsOperator TypeReference
	 *   ;
	 *
	 */
	private parseNamedInfix() : tree.IExpression
	{
		let left = this.parseAdditiveExpression();
		if (left == null) return null;

		let right : tree.IExpression = null;

		let type : TokenType = null;
		if (this.tokens.peekType() == TokenType.TOK_NOT && this.tokens.peekTypeAt(1) == TokenType.TOK_IN) // not in
		{
			this.tokens.discard(2);
			type = TokenType.TOK_NIN;
		}
		else
		if (this.tokens.peekType() == TokenType.TOK_NOT && this.tokens.peekTypeAt(1) == TokenType.TOK_IS) // not is
		{
			this.tokens.discard(2);
			type = TokenType.TOK_NIS;
		}
		else
		if (this.tokens.peekType() == TokenType.TOK_IN ||  // in
		    this.tokens.peekType() == TokenType.TOK_IS)    // is
		{
			type = this.tokens.read().type;
		}
		else
			return left;

		if (type == TokenType.TOK_IN || type == TokenType.TOK_NIN)
			right = this.parseAdditiveExpression();
		else
		if (type == TokenType.TOK_IS || type == TokenType.TOK_NIS)
			right = new tree.NameLiteral(this.parseName());
		else
			return null;

		let result = new tree.BinaryExpression(left, type, right);
		//result.location = left.location;
		return result;
	}

	/**
	 * MultiplicativeExpression: PrefixUnaryExpression ( MultiplicativeOperator MultiplicativeExpression )*
	 *
	 */
	private parseAdditiveExpression() : tree.IExpression
	{
		let left = this.parseMultiplicativeExpression();
		if (left == null) return null;

		let type : TokenType = null;
		switch(this.tokens.peekType())
		{
			case TokenType.TOK_MINUS: // -
			case TokenType.TOK_PLUS:  // +
				type = this.tokens.read().type;
				break;
			default:
				return left;
		}

		return this.createBinaryExpression(left, type, this.parseAdditiveExpression());
	}

	/**
	 * MultiplicativeExpression: PrefixUnaryExpression ( MultiplicativeOperator MultiplicativeExpression )*
	 *
	 */
	private parseMultiplicativeExpression() : tree.IExpression
	{
		let left = this.parsePrefixUnaryExpression();
		if (left == null) return null;

		let type : TokenType = null;
		switch(this.tokens.peekType())
		{
			case TokenType.TOK_MUL: // *
			case TokenType.TOK_DIV: // /
			case TokenType.TOK_MOD: // %
				type = this.tokens.read().type;
				break;
			default:
				return left;
		}

		return this.createBinaryExpression(left, type, this.parseMultiplicativeExpression());
	}

	/**
	 *
	 * PrefixUnaryExpression: PrefixUnaryOperator? PostfixUnaryExpression
	 *
	 */
	private parsePrefixUnaryExpression(leftValue : tree.IExpression = null) : tree.IExpression
	{
		let recursive = false;

		let type : TokenType = null;
		switch(this.tokens.peekType())
		{
			case TokenType.TOK_INC:
			case TokenType.TOK_DEC:
				type = this.tokens.read().type;
				break;
			default:
				type = null;
		}
		// FIXME: broken in recursive case (should test for more prefixes)?
		let expr = leftValue;
		if (leftValue == null)
			expr = this.parsePostfixUnaryExpression();

		if (type != null)
		{
			if (recursive)
				return new tree.UnaryExpression(this.parsePrefixUnaryExpression(expr), type, tree.UnaryDirection.PREFIX);
			else
				return new tree.UnaryExpression(expr, type, tree.UnaryDirection.PREFIX);
		}

		return expr;
	}

	/**
	 *
	 * PostfixUnaryExpression: AtomicExpression PostfixUnaryOperator?
	 *
	 */
	private parsePostfixUnaryExpression(leftValue : tree.IExpression = null) : tree.IExpression
	{
		let expr : tree.IExpression = leftValue;
		let extra : tree.IExpression = null;

		if (leftValue == null)
			expr = this.parseAtomicExpression();
		if (expr == null) return null;

		let recursive = false;

		let type : TokenType = null;
		switch(this.tokens.peekType())
		{
			case TokenType.TOK_INC:
			case TokenType.TOK_DEC:
				type = this.tokens.read().type;
				break;
			case TokenType.TOK_LEFT_BRACKET:
				type = this.tokens.peekType();
				extra = this.parseArrayAccess(null);
				break;
			case TokenType.TOK_LEFT_PAR:
				type = this.tokens.peekType();
				extra = this.parseArgumentList(null);
				break;
			default:
				type = null;
		}

		if (type != null)
		{
			let result : tree.UnaryExpression = null;

			if (recursive)
				result = new tree.UnaryExpression(this.parsePostfixUnaryExpression(expr), type, tree.UnaryDirection.POSTFIX);
			else
				result = new tree.UnaryExpression(expr, type, tree.UnaryDirection.POSTFIX);

			if (extra != null) result.extra = extra;
			return result;
		}

		return expr;
	}

	/**
	 * ArgumentList:
	 *   : "(" ")"
	 *   : "(" Argument ( "," Argument )* ")"
	 */
	private parseArgumentList(value : tree.ArgumentList) : tree.ArgumentList
	{
		if (this.tokens.lookahead(false, TokenType.TOK_LEFT_PAR, TokenType.TOK_RIGHT_PAR))
		{
			this.tokens.discard(2);
			return new tree.ArgumentList();
		}

		if (value == null)
		{
			if (!this.expectedOneOf(TokenType.TOK_LEFT_PAR)) return null;
			this.tokens.discard();

			let result = new tree.ArgumentList( this.parseArgument() );
			if (this.tokens.peekType() == TokenType.TOK_COMA)
			this.parseArgumentList(result);

			if (!this.expectedOneOf(TokenType.TOK_RIGHT_PAR)) return null;
			this.tokens.discard();

			return result;
		}
		else
		{
			if (!this.expectedOneOf(TokenType.TOK_COMA)) return null;
			this.tokens.discard();

			while (true)
			{
				value.args.push( this.parseArgument() );
				if (this.tokens.peekType() == TokenType.TOK_COMA)
				{
					this.tokens.discard();
					continue;
				}
				break;
			}

			return value;
		}
	}

	private parseArgument() : tree.Argument
	{
		let name : tree.Name = null;

		if (this.tokens.lookahead(false, TokenType.TOK_NAME, TokenType.TOK_ASSIGN))
		{
			name = this.parseName();
			this.tokens.discard(2);
		}

		return new tree.Argument(name, this.parseExpression());
	}

	/**
	 * ArrayAccess: "[" Expression ( "," Expression )* "]"
	 */
	private parseArrayAccess(value : tree.ExpressionList) : tree.IExpression
	{
		if (value == null)
		{
			if (!this.expectedOneOf(TokenType.TOK_LEFT_BRACKET)) return null;
			this.tokens.discard();

			let result = new tree.ExpressionList( this.parseExpression() );
			if (this.tokens.peekType() == TokenType.TOK_COMA)
			this.parseArrayAccess(result);

			if (!this.expectedOneOf(TokenType.TOK_RIGHT_BRACKET)) return null;
			this.tokens.discard();

			return result;
		}
		else
		{
			if (!this.expectedOneOf(TokenType.TOK_COMA)) return null;
			this.tokens.discard();

			value.expressions.push( this.parseExpression() );
			if (this.tokens.peekType() == TokenType.TOK_COMA)
				return this.parseArrayAccess(value);
			else
				return value;
		}
	}

	/**
	 *
	 * AtomicExpression
	 *   : "(" Expression ")"
	 *   : LiteralConstant
	 *   : Name
	 *   ;
	 *
	 * @return
	 */
	private parseAtomicExpression() : tree.IExpression
	{
		let result : tree.IExpression = null;

		switch(this.tokens.peekType())
		{
			case TokenType.TOK_LEFT_PAR:
				this.tokens.discard();
				result = new tree.AtomicExpression(this.parseExpression());
				this.tokens.discard();
				return result;
			case TokenType.TOK_NAME:
				return new tree.NameLiteral( this.parseName() );
			default:
				return this.parseLiteralConstant();
		}
	}

	/**
	 * LiteralConstant
	 *  : BooleanLiteral
	 *  : StringLiteral
	 *  : IntegerLiteral
	 *  : "null"
	 *  ;
	 *
	 * @return
	 */
	private parseLiteralConstant() : tree.IExpression
	{
		switch(this.tokens.peekType())
		{
			case TokenType.TOK_NULL:
				this.tokens.discard();
				return new tree.NullLiteral();
			case TokenType.TOK_TRUE:
			case TokenType.TOK_FALSE:
				return this.parseBooleanLiteral();
			case TokenType.TOK_HEX_LITERAL:
			case TokenType.TOK_BIN_LITERAL:
			case TokenType.TOK_OCT_LITERAL:
			case TokenType.TOK_DEC_LITERAL:
				return this.parseIntegerLiteral();
			case TokenType.TOK_FP_LITERAL:
				return this.parseFloatLiteral();
			case TokenType.TOK_STRING_LITERAL:
				return this.parseStringLiteral();
			default:
				//this.context.listener.onError(this.tokens.peek().location, "Unexpected token '" + this.tokens.peek().type.token + "'");
				return null;
		}

	}

	private parseIntegerLiteral() : tree.IntegerLiteral
	{
		let value = this.tokens.peek().value;
		switch(this.tokens.read().type)
		{
			case TokenType.TOK_HEX_LITERAL:
				value = value.substring(2);
				return new tree.IntegerLiteral(value, 16);
			case TokenType.TOK_BIN_LITERAL:
				value = value.substring(2);
				return new tree.IntegerLiteral(value, 2);
			case TokenType.TOK_OCT_LITERAL:
				return new tree.IntegerLiteral(value, 8);
			case TokenType.TOK_DEC_LITERAL:
				return new tree.IntegerLiteral(value, 10);
			default:
				//this.context.listener.onError(this.tokens.peek().location, "Invalid integer literal '" + this.tokens.peek().value + "'");
				return null;
		}
	}

	private parseStringLiteral() : tree.StringLiteral
	{
		let value = this.tokens.read().value;
		this.context.stringTable.push(value);
		return new tree.StringLiteral(value);
	}

	private parseFloatLiteral() : tree.FloatLiteral
	{
		let value = this.tokens.read().value;
		return new tree.FloatLiteral(value);
	}

	private parseBooleanLiteral() : tree.BooleanLiteral
	{
		if (!this.expectedOneOf(TokenType.TOK_TRUE, TokenType.TOK_FALSE)) return null;

		let value = (this.tokens.read().type == TokenType.TOK_TRUE);
		return new tree.BooleanLiteral(value);
	}

}

}